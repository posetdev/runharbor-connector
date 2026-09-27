#!/usr/bin/env bash
# RunHarbor customer-owned Linux x64 bootstrap.  This file is installed by the
# customer as a fixed boot artifact; SaaS never supplies its arguments.
set -euo pipefail
set +x

readonly CONFIG_PATH=/etc/runharbor/linux-x64-runner.conf
readonly CLIENT_PATH="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")" && pwd)/linux-x64-claim.py"
readonly RUNTIME_PARENT=/run
readonly RUNTIME_TMPFS_SIZE=1024m
# The job's workspace is the one thing whose size the customer's CI decides, so
# it is the one thing that cannot live in the RAM-backed runtime. It is bind
# mounted onto _work from the encrypted root volume, which EC2 deletes with the
# instance; credentials, JIT and logs stay in the tmpfs above.
readonly WORK_PARENT=/var/lib/runharbor/work
readonly RUNNER_USER=runharbor-runner
readonly RUNNER_VERSION=2.337.0
# Docker CE comes from Docker's own apt archive. The archive, its signing-key
# fingerprint and the five package versions are pinned here, and every value is
# the same on x64 and arm64. Why this archive instead of Ubuntu's own pocket is
# argued at the install block below; the trust model matches the runner tarball
# download -- one fixed HTTPS origin plus one pinned integrity anchor (there, the
# sha256 constant; here, the signing-key fingerprint).
readonly DOCKER_KEY_URL=https://download.docker.com/linux/ubuntu/gpg
readonly DOCKER_APT_URL=https://download.docker.com/linux/ubuntu
# The long-lived Docker apt archive signing key ("Docker Release (CE deb)"), as
# published at the key URL above and in Docker's own install documentation.
readonly DOCKER_GPG_FINGERPRINT=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
readonly DOCKER_CE_VERSION=5:29.8.1-1~ubuntu.24.04~noble
readonly DOCKER_CONTAINERD_VERSION=2.3.6-1~ubuntu.24.04~noble
readonly DOCKER_BUILDX_VERSION=0.37.1-1~ubuntu.24.04~noble
readonly DOCKER_COMPOSE_VERSION=5.5.1-1~ubuntu.24.04~noble

runner_pid=''
runtime_dir=''
runtime_mounted=0
work_mounted=0

# Every outcome is terminal for this single-use boot artifact. Finish all
# bootstrap-owned cleanup first, then ask the OS to power off exactly once.
# EC2's fixed launch setting maps that guest shutdown to instance termination.
cleanup() {
  local status="$1" ticks=0
  trap - EXIT HUP INT TERM
  set +e
  if [[ -n "$runner_pid" ]]; then
    kill -TERM -- "-$runner_pid" 2>/dev/null || true
    while kill -0 -- "-$runner_pid" 2>/dev/null && (( ticks < 20 )); do /usr/bin/sleep 0.1; ((ticks += 1)); done
    kill -KILL -- "-$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
  fi
  # The workspace bind mount sits inside the runtime tmpfs, so it has to come off
  # first: otherwise the tmpfs umount fails and the runtime outlives the poweroff.
  if [[ "$work_mounted" == 1 && -n "$runtime_dir" ]]; then
    /usr/bin/umount "$runtime_dir/runner/_work" 2>/dev/null || true
  fi
  if [[ "$runtime_mounted" == 1 && -n "$runtime_dir" ]]; then
    /usr/bin/umount "$runtime_dir" 2>/dev/null || true
  fi
  if [[ -n "$runtime_dir" ]]; then
    /usr/bin/rm -rf -- "$runtime_dir" 2>/dev/null || true
  fi
  # --no-block makes the systemd job asynchronous; timeout also bounds a
  # stalled systemctl/D-Bus invocation. Failure leaves the fixed TTL sweeper as
  # the independent fallback and must not replace the runner/signal status.
  /usr/bin/timeout --signal=KILL 10 /usr/bin/systemctl poweroff --no-block >/dev/null 2>&1 || true
  exit "$status"
}
trap 'cleanup $?' EXIT
trap 'cleanup 129' HUP
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

die() { printf '%s\n' "runharbor-bootstrap: $1" >&2; exit 1; }

runner_failure_category() {
  local output_log="$1" runner_dir="$2"
  if LC_ALL=C /usr/bin/grep -Eiq -- 'deprecated|no longer supported|runner version[^[:cntrl:]]*too old' "$output_log" "$runner_dir"/_diag/Runner_*.log 2>/dev/null; then
    printf '%s' deprecated
  elif LC_ALL=C /usr/bin/grep -Eiq -- 'couldn.t find a valid ICU|dependency|shared librar|libicu|libssl|libkrb|liblttng|zlib' "$output_log" "$runner_dir"/_diag/Runner_*.log 2>/dev/null; then
    printf '%s' dependency
  elif LC_ALL=C /usr/bin/grep -Eiq -- 'network|connect|connection|resolve|name or service not known|temporary failure|timed out|TLS|certificate' "$output_log" "$runner_dir"/_diag/Runner_*.log 2>/dev/null; then
    printf '%s' network
  else
    printf '%s' unknown
  fi
}

[[ "$(/usr/bin/uname -s)" == Linux ]] || die 'Linux is required'
# The runner tarball and its checksum are both architecture-specific. Neither
# value can be taken on trust: the actions/runner release body publishes no
# checksums at all, so both were computed from the downloaded artifacts, with
# the previously committed x64 constant used as a positive control. An
# unrecognised machine must refuse by name rather than reach for an x64 tarball.
case "$(/usr/bin/uname -m)" in
  x86_64) runner_arch=x64; runner_sha256=70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613 ;;
  aarch64) runner_arch=arm64; runner_sha256=9b1dc70626422526e3c94767cf024896beb15da5342a3f4819bf2feac13e0393 ;;
  *) die "unsupported machine architecture $(/usr/bin/uname -m)" ;;
esac
readonly RUNNER_ARCH="$runner_arch"
readonly RUNNER_SHA256="$runner_sha256"
readonly RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
[[ "$(/usr/bin/id -u)" == 0 ]] || die 'must start as root in order to create the dedicated runner user'
[[ -x /usr/bin/python3 ]] || die 'python3 is required'
[[ -x /usr/bin/mount && -x /usr/bin/umount ]] || die 'mount tools are required'
[[ -r "$CONFIG_PATH" && ! -L "$CONFIG_PATH" ]] || die 'fixed bootstrap configuration is unavailable'
[[ "$(/usr/bin/stat -c '%u:%a' "$CONFIG_PATH")" == 0:600 ]] || die 'fixed bootstrap configuration must be root-owned mode 0600'
[[ -x "$CLIENT_PATH" ]] || die 'claim client is unavailable'

declare -A config=()
while IFS='=' read -r name value; do
  [[ "$name" =~ ^(RUNHARBOR_REGION|RUNHARBOR_CLAIM_URL|RUNHARBOR_OPERATION_ID)$ ]] || die 'invalid fixed bootstrap configuration'
  [[ -n "$value" && -z "${config[$name]+x}" ]] || die 'invalid fixed bootstrap configuration'
  config[$name]="$value"
done < "$CONFIG_PATH"
[[ ${#config[@]} == 3 ]] || die 'invalid fixed bootstrap configuration'
readonly REGION="${config[RUNHARBOR_REGION]}"
readonly CLAIM_URL="${config[RUNHARBOR_CLAIM_URL]}"
readonly OPERATION_ID="${config[RUNHARBOR_OPERATION_ID]}"
[[ "$REGION" =~ ^[a-z]{2}(-[a-z0-9]+)+-[0-9]+$ ]] || die 'invalid fixed bootstrap configuration'
[[ "$OPERATION_ID" =~ ^op_[a-f0-9]{64}$ ]] || die 'invalid fixed bootstrap configuration'
[[ "$CLAIM_URL" =~ ^https://[a-z0-9]{32}\.lambda-url\.${REGION}\.on\.aws/jit/claim$ ]] || die 'invalid fixed bootstrap configuration'

# The customer launch profile must enforce IMDSv2.  Runner credentials, JIT and
# logs must remain in tmpfs; only the job workspace is bind mounted to disk below.
[[ "$(/usr/bin/findmnt -n -o FSTYPE --target "$RUNTIME_PARENT")" == tmpfs ]] || die '/run is not tmpfs'
# A tmpfs is RAM. Sizing one at or above MemTotal makes the instance OOM-kill
# itself mid-bootstrap, and cloud-init's once-per-instance semaphore then turns
# that into permanent silent death on the next boot. Refuse the profile by name
# instead, while there is still a console to print it to. Read with bash builtins
# only: the fixed package set has no awk.
while IFS=':' read -r meminfo_key meminfo_value; do
  [[ "$meminfo_key" == MemTotal ]] || continue
  mem_total_kib="${meminfo_value%%kB}"
  mem_total_kib="${mem_total_kib// /}"
  break
done < /proc/meminfo
[[ "${mem_total_kib:-}" =~ ^[0-9]+$ ]] || die 'MemTotal is unreadable'
(( mem_total_kib >= 2 * ${RUNTIME_TMPFS_SIZE%m} * 1024 )) || die 'instance memory cannot back the runtime tmpfs'
runtime_dir="$(/usr/bin/mktemp -d "$RUNTIME_PARENT/runharbor-runner.XXXXXXXX")"
# Ubuntu 24.04's initramfs mounts /run at 10% of RAM. A 2 GiB instance
# therefore cannot hold the 223 MB archive plus its approximately 669 MB
# expanded runner. Keep /run intact and give only this bootstrap an explicitly
# bounded private tmpfs. noexec is intentionally absent: Runner.Listener runs
# from this mount.
/usr/bin/mount -t tmpfs -o "mode=0700,nosuid,nodev,size=${RUNTIME_TMPFS_SIZE}" tmpfs "$runtime_dir"
runtime_mounted=1

if ! /usr/bin/id -u "$RUNNER_USER" >/dev/null 2>&1; then
  # The account needs a real login shell. `su`, `runuser -l`, `script` and tmux
  # all start a pane or session by running the command through the account's
  # passwd shell: with /usr/sbin/nologin that child exits immediately, so a tmux
  # `new-session` still reports success and then the server dies, and a test that
  # drives a terminal fails later with `no server running`. Nothing is given away
  # by allowing it either -- the account already has NOPASSWD: ALL below and runs
  # arbitrary workflow code, so nologin withheld no privilege, only working tools.
  /usr/sbin/useradd --system --create-home --home-dir /nonexistent --shell /bin/bash "$RUNNER_USER"
fi
[[ "$(/usr/bin/id -u "$RUNNER_USER")" != 0 ]] || die 'runner user must not be root'
# CI jobs are already equivalent to root because they can run arbitrary code.
# Keep their runner process non-root so only bootstrap-owned processes see JIT,
# then grant the dedicated account the NOPASSWD sudo parity GitHub runners use.
[[ -x /usr/bin/sudo ]] || die 'sudo is required for CI jobs'
[[ -d /etc/sudoers.d && ! -L /etc/sudoers.d ]] || die 'sudoers directory is required for CI jobs'
readonly SUDOERS_PATH=/etc/sudoers.d/runharbor-runner
printf '%s\n' "$RUNNER_USER ALL=(ALL) NOPASSWD: ALL" > "$SUDOERS_PATH"
/usr/bin/chown root:root "$SUDOERS_PATH"
/usr/bin/chmod 0440 "$SUDOERS_PATH"

# A service container is created by the runner before the job's first step, so
# a workflow declaring `services:` needs a working daemon at job start -- which
# is earlier than any step of that workflow could install one. Waiting for the
# image to provide Docker made the image's distribution part of the contract:
# it is why the host is now one distribution on both architectures rather than
# whatever each architecture happened to carry.
#
# The host is Canonical's Ubuntu 24.04 LTS and nothing else, so install Docker CE
# from Docker's own apt archive at download.docker.com, with the archive's
# signing-key fingerprint and the five package versions pinned at the top of
# this file -- the same archive, key and package set GitHub's ubuntu-latest
# image installs (its install-docker.sh), which is also the only source that
# carries the buildx and compose plugins `container:`-heavy workflows expect.
# Ubuntu's own pocket cannot host this pin: noble freezes docker.io at one
# version and then removes every superseded one from -updates/-security, so a
# pinned version there is a scheduled boot failure and an unpinned one is an
# unreviewed floating update. The Docker archive keeps every release it ever
# published, so these versions stay installable indefinitely.
if ! /usr/bin/systemctl cat docker.service >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  # The package versions below are noble's. Refuse by name on any other host
  # rather than let apt fail later on an unfindable version string.
  ubuntu_codename=''
  while IFS='=' read -r os_key os_value; do
    [[ "$os_key" == UBUNTU_CODENAME ]] || continue
    ubuntu_codename="$os_value"
    break
  done < /etc/os-release
  [[ "$ubuntu_codename" == noble ]] || die "this host is not Ubuntu 24.04 LTS: release codename ${ubuntu_codename:-unreadable}"
  /usr/bin/apt-get update -qq || die 'the package index could not be refreshed to install Docker'
  # ca-certificates and curl are what verify and fetch the archive key; gpg is
  # what proves the fetched key is the pinned one. Installing them first keeps
  # the pin checkable instead of trusting a bare download.
  /usr/bin/apt-get install -y -qq --no-install-recommends ca-certificates curl gpg || die 'ca-certificates curl gpg could not be installed'
  key_path="$runtime_dir/docker-apt-key.asc"
  /usr/bin/curl --fail --silent --show-error --location --max-redirs 3 --proto '=https' --tlsv1.2 \
    --connect-timeout 10 --max-time 60 "$DOCKER_KEY_URL" --output "$key_path" \
    || die 'the Docker apt repository signing key could not be downloaded'
  # gpg lists the primary key's fingerprint as the first `fpr:::::::::HEX:` line
  # and then one per subkey. Take the first and compare it with the pin: a key
  # that is not the pinned one must never become a repository. Parse with bash
  # IFS only -- the fixed package set has no awk.
  docker_fingerprint=''
  key_report="$(/usr/bin/gpg --batch --with-colons --show-keys "$key_path" 2>/dev/null || true)"
  while IFS=: read -r key_kind _ _ _ _ _ _ _ _ key_fpr _; do
    [[ "$key_kind" == fpr && -z "$docker_fingerprint" ]] || continue
    docker_fingerprint="$key_fpr"
  done <<<"$key_report"
  [[ "$docker_fingerprint" == "$DOCKER_GPG_FINGERPRINT" ]] || die 'the Docker apt repository signing key fingerprint mismatched the pinned one'
  /usr/bin/install -d -m 0755 /etc/apt/keyrings
  /usr/bin/install -m 0644 "$key_path" /etc/apt/keyrings/docker.asc
  # apt 2.4+ accepts the armored key directly as signed-by=.
  printf '%s\n' "deb [signed-by=/etc/apt/keyrings/docker.asc] ${DOCKER_APT_URL} ${ubuntu_codename} stable" > /etc/apt/sources.list.d/docker.list
  /usr/bin/apt-get update -qq || die 'the Docker package index could not be refreshed'
  /usr/bin/apt-get install -y -qq --no-install-recommends \
    "docker-ce=${DOCKER_CE_VERSION}" \
    "docker-ce-cli=${DOCKER_CE_VERSION}" \
    "containerd.io=${DOCKER_CONTAINERD_VERSION}" \
    "docker-buildx-plugin=${DOCKER_BUILDX_VERSION}" \
    "docker-compose-plugin=${DOCKER_COMPOSE_VERSION}" \
    || die 'docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin could not be installed'
  # dpkg creates both the unit and the group. Saying so is what keeps a
  # succeeding install that produced neither from looking like a working host.
  /usr/bin/systemctl cat docker.service >/dev/null 2>&1 || die 'docker.service is absent after installing the pinned Docker packages'
fi

# Docker's socket is root:docker. CI jobs already have deliberate NOPASSWD sudo
# authority above, so give the non-root runner the same direct Docker access
# GitHub-hosted runners have. The check stays conditional because the group is
# dpkg's to create, and asserting it here would only restate the install above.
if /usr/bin/getent group docker >/dev/null 2>&1; then
  /usr/sbin/usermod --append --groups docker "$RUNNER_USER"
fi

# An image may ship Docker without enabling it. Leave an already-active daemon
# alone, or start it before Runner.Listener inherits this user's supplementary
# groups -- a daemon started afterwards is a daemon the job cannot reach.
if ! /usr/bin/systemctl is-active --quiet docker.service; then
  /usr/bin/systemctl start docker.service || die 'docker.service could not be started'
fi
/usr/bin/install -d -m 0700 -o "$RUNNER_USER" -g "$RUNNER_USER" "$runtime_dir/runner"

archive="$runtime_dir/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
/usr/bin/curl --fail --silent --show-error --location --max-redirs 3 --proto '=https' --tlsv1.2 \
  --connect-timeout 10 --max-time 120 "$RUNNER_URL" --output "$archive"
echo "${RUNNER_SHA256}  ${archive}" | /usr/bin/sha256sum --check --status || die 'official runner checksum mismatch'
/usr/bin/tar --extract --gzip --file "$archive" --directory "$runtime_dir/runner" --no-same-owner --no-same-permissions
/usr/bin/rm -f -- "$archive"
/usr/bin/chown -R "$RUNNER_USER:$RUNNER_USER" "$runtime_dir/runner"

# _work is where the job checks out and builds, and how big it gets is the
# customer's CI to decide, not ours. Give it the root volume rather than the
# bounded tmpfs — without telling GitHub anything new: work_folder stays the
# relative `_work` the JIT config already names, and the bind mount changes only
# where that path lands.
/usr/bin/install -d -m 0700 -o "$RUNNER_USER" -g "$RUNNER_USER" "$WORK_PARENT"
/usr/bin/install -d -m 0700 -o "$RUNNER_USER" -g "$RUNNER_USER" "$runtime_dir/runner/_work"
/usr/bin/mount --bind "$WORK_PARENT" "$runtime_dir/runner/_work"
work_mounted=1

jit_path="$runtime_dir/jit.json"
/usr/bin/python3 "$CLIENT_PATH" --region "$REGION" --claim-url "$CLAIM_URL" --operation-id "$OPERATION_ID" --output "$jit_path"
/usr/bin/chown -R "$RUNNER_USER:$RUNNER_USER" "$runtime_dir"
/usr/bin/chmod 0700 "$runtime_dir" "$runtime_dir/runner"
/usr/bin/chmod 0600 "$jit_path"

# --jitconfig is necessarily visible to same-host privileged/proc observers.
# The dedicated non-root user and private tmpfs reduce exposure; they do not
# make an absolute secrecy claim. Invoke Listener exactly once and bypass the
# official run.sh/run-helper wrappers because they map internal failures to 0.
/usr/bin/setsid /usr/sbin/runuser -u "$RUNNER_USER" -- /bin/bash -c 'cd "$1"; umask 077; exec ./bin/Runner.Listener run --jitconfig "$(/usr/bin/cat "$2")"' /bin/bash "$runtime_dir/runner" "$jit_path" \
  >"$runtime_dir/runner-output.log" 2>&1 &
runner_pid=$!
set +e
wait "$runner_pid"
runner_status=$?
set -e
if [[ "$runner_status" == 0 ]]; then
  printf 'runharbor-bootstrap: runner exited status=0\n'
else
  runner_category="$(runner_failure_category "$runtime_dir/runner-output.log" "$runtime_dir/runner")"
  printf 'runharbor-bootstrap: runner exited status=%s category=%s\n' "$runner_status" "$runner_category"
fi
exit "$runner_status"
