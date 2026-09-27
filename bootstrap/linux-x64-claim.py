#!/usr/bin/python3
"""Fixed IMDSv2 to Function URL JIT client; standard library only."""

import argparse
import contextlib
import datetime as dt
import hashlib
import hmac
import http.client
import json
import os
import re
import signal
import ssl
import sys
import time
import urllib.parse

MAX_BODY = 70 * 1024
MAX_TOKEN = 1024
MAX_FIELD = 4096
DEADLINE = 5.0
TOTAL_DEADLINE = 300.0
MAX_READINESS_GETS = 60
POLL_INTERVAL = 5.0
IMDS = "http://169.254.169.254"
OP = re.compile(r"^op_[a-f0-9]{64}$")
REGION = re.compile(r"^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+$")
RUNNER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
ROLE = re.compile(r"^[A-Za-z0-9+=,.@_-]{1,128}$")
ACCESS_KEY = re.compile(r"^(?:AKIA|ASIA)[A-Z0-9]{16}$")
TIMESTAMP = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")


class ClaimError(Exception):
    """A deliberately detail-free bootstrap failure."""


class FixedArgumentParser(argparse.ArgumentParser):
    def error(self, _message):
        bad()


def bad():
    raise ClaimError()


def ascii_bytes(raw, limit):
    if not isinstance(raw, bytes) or not raw or len(raw) > limit:
        bad()
    try:
        value = raw.decode("ascii")
    except Exception:
        bad()
    if any(ord(character) < 33 or ord(character) > 126 for character in value):
        bad()
    return value


def pairs(items):
    result = {}
    for key, value in items:
        if not isinstance(key, str) or key in result:
            bad()
        result[key] = value
    return result


def obj(raw):
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs)
    except Exception:
        bad()
    if not isinstance(value, dict):
        bad()
    return value


def url(value, https=False):
    if (
        not isinstance(value, str)
        or len(value) > 512
        or any(ord(character) < 33 or ord(character) > 126 for character in value)
    ):
        bad()
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except Exception:
        bad()
    if (
        parsed.scheme not in ("http", "https")
        or (https and parsed.scheme != "https")
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or port is not None
        or parsed.query
        or parsed.fragment
    ):
        bad()
    return parsed


@contextlib.contextmanager
def deadline_alarm(deadline):
    """Make the deadline absolute even when a peer sends continual slow bytes."""
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        bad()

    def expired(_signum, _frame):
        bad()

    previous_handler = signal.getsignal(signal.SIGALRM)
    signal.signal(signal.SIGALRM, expired)
    previous_delay, previous_interval = signal.setitimer(signal.ITIMER_REAL, remaining)
    started = time.monotonic()
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_delay > 0:
            elapsed = time.monotonic() - started
            signal.setitimer(
                signal.ITIMER_REAL,
                max(0.000001, previous_delay - elapsed),
                previous_interval,
            )


def request(target, method, headers=None, body=None, deadline=None, canonical_query=None):
    """Perform one direct request under one monotonic connect/read deadline."""
    if deadline is None:
        deadline = time.monotonic() + DEADLINE
    if canonical_query is not None:
        suffix = "?" + canonical_query
        if not canonical_query or not target.endswith(suffix):
            bad()
        parsed = url(target[: -len(suffix)])
        request_path = (parsed.path or "/") + suffix
    else:
        parsed = url(target)
        request_path = parsed.path or "/"
    connection = None
    try:
        with deadline_alarm(deadline):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                bad()
            if parsed.scheme == "https":
                connection = http.client.HTTPSConnection(
                    parsed.hostname,
                    timeout=remaining,
                    context=ssl.create_default_context(),
                )
            else:
                connection = http.client.HTTPConnection(parsed.hostname, timeout=remaining)
            connection.request(method, request_path, body=body, headers=headers or {})
            response = connection.getresponse()
            chunks = []
            size = 0
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    bad()
                if connection.sock:
                    connection.sock.settimeout(remaining)
                chunk = response.read1(min(4096, MAX_BODY + 1 - size))
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_BODY:
                    bad()
                chunks.append(chunk)
            return response.status, b"".join(chunks)
    except ClaimError:
        raise
    except Exception:
        bad()
    finally:
        if connection:
            try:
                connection.close()
            except Exception:
                pass


def credential_timestamp(value):
    if not isinstance(value, str) or not TIMESTAMP.fullmatch(value):
        bad()
    try:
        parsed = dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    except Exception:
        bad()
    return parsed


def credentials(deadline):
    status, token = request(
        IMDS + "/latest/api/token",
        "PUT",
        {"X-aws-ec2-metadata-token-ttl-seconds": "60"},
        deadline=deadline,
    )
    if status != 200:
        bad()
    headers = {"X-aws-ec2-metadata-token": ascii_bytes(token, MAX_TOKEN)}
    status, role = request(
        IMDS + "/latest/meta-data/iam/security-credentials/",
        "GET",
        headers,
        deadline=deadline,
    )
    if status != 200:
        bad()
    role = ascii_bytes(role.strip(), 128)
    if not ROLE.fullmatch(role):
        bad()
    status, raw = request(
        IMDS + "/latest/meta-data/iam/security-credentials/" + role,
        "GET",
        headers,
        deadline=deadline,
    )
    value = obj(raw)
    required = {
        "Code",
        "LastUpdated",
        "Type",
        "AccessKeyId",
        "SecretAccessKey",
        "Token",
        "Expiration",
    }
    if status != 200 or set(value) != required or value["Code"] != "Success" or value["Type"] != "AWS-HMAC":
        bad()
    for field in ("AccessKeyId", "SecretAccessKey", "Token", "Expiration"):
        item = value[field]
        if (
            not isinstance(item, str)
            or not item
            or len(item) > MAX_FIELD
            or any(ord(character) < 33 or ord(character) > 126 for character in item)
        ):
            bad()
    if not ACCESS_KEY.fullmatch(value["AccessKeyId"]):
        bad()
    now = dt.datetime.now(dt.timezone.utc)
    last_updated = credential_timestamp(value["LastUpdated"])
    expiry = credential_timestamp(value["Expiration"])
    if (
        last_updated > now + dt.timedelta(minutes=5)
        or expiry <= now
        or expiry <= last_updated
        or expiry > now + dt.timedelta(hours=12)
    ):
        bad()
    return value


def signing_key(secret, date, region):
    value = ("AWS4" + secret).encode("ascii")
    for part in (date, region, "lambda", "aws4_request"):
        value = hmac.new(value, part.encode("ascii"), hashlib.sha256).digest()
    return value


def signed_request(region, target, method, canonical_path, canonical_query, body, deadline):
    if canonical_query:
        suffix = "?" + canonical_query
        if not target.endswith(suffix):
            bad()
        base_target = target[: -len(suffix)]
    else:
        base_target = target
    parsed = url(base_target, https=True)
    if parsed.path != canonical_path:
        bad()
    creds = credentials(deadline)
    payload = body if body is not None else b""
    now = dt.datetime.now(dt.timezone.utc)
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    date = now.strftime("%Y%m%d")
    digest = hashlib.sha256(payload).hexdigest()
    headers = {
        "host": parsed.hostname,
        "x-amz-content-sha256": digest,
        "x-amz-date": stamp,
        "x-amz-security-token": creds["Token"],
    }
    if body is not None:
        headers["content-type"] = "application/json"
    signed_headers = ";".join(sorted(headers))
    canonical_headers = "".join(
        name + ":" + headers[name] + "\n" for name in sorted(headers)
    )
    canonical_request = (
        method
        + "\n"
        + canonical_path
        + "\n"
        + canonical_query
        + "\n"
        + canonical_headers
        + "\n"
        + signed_headers
        + "\n"
        + digest
    )
    scope = f"{date}/{region}/lambda/aws4_request"
    string_to_sign = (
        "AWS4-HMAC-SHA256\n"
        + stamp
        + "\n"
        + scope
        + "\n"
        + hashlib.sha256(canonical_request.encode("ascii")).hexdigest()
    )
    signature = hmac.new(
        signing_key(creds["SecretAccessKey"], date, region),
        string_to_sign.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    headers["Authorization"] = (
        f'AWS4-HMAC-SHA256 Credential={creds["AccessKeyId"]}/{scope}, '
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return request(
        target,
        method,
        headers,
        body,
        deadline,
        canonical_query if canonical_query else None,
    )


def call_deadline(total_deadline):
    now = time.monotonic()
    remaining = total_deadline - now
    if remaining <= 0:
        bad()
    return now + min(DEADLINE, remaining)


def wait_interval(total_deadline):
    remaining = total_deadline - time.monotonic()
    if remaining <= 0:
        bad()
    time.sleep(min(POLL_INTERVAL, remaining))
    if time.monotonic() >= total_deadline:
        bad()


def claim(region, target, operation):
    parsed = url(target, https=True)
    host_pattern = re.compile(
        r"^[a-z0-9]{32}\.lambda-url\." + re.escape(region) + r"\.on\.aws$"
    )
    if parsed.path != "/jit/claim" or not host_pattern.fullmatch(parsed.hostname):
        bad()
    total_deadline = time.monotonic() + TOTAL_DEADLINE
    readiness_query = "operationId=" + operation
    readiness_target = (
        "https://" + parsed.hostname + "/jit/readiness?" + readiness_query
    )
    for attempt in range(MAX_READINESS_GETS):
        status, raw = signed_request(
            region,
            readiness_target,
            "GET",
            "/jit/readiness",
            readiness_query,
            None,
            call_deadline(total_deadline),
        )
        value = obj(raw)
        if (
            status != 200
            or set(value) != {"operationId", "status"}
            or value.get("operationId") != operation
            or value.get("status") not in ("pending", "ready", "terminal")
        ):
            bad()
        if value["status"] == "ready":
            break
        if value["status"] == "terminal" or attempt == MAX_READINESS_GETS - 1:
            bad()
        wait_interval(total_deadline)
    else:
        bad()

    body = json.dumps({"operationId": operation}, separators=(",", ":")).encode("ascii")
    status, raw = signed_request(
        region,
        target,
        "POST",
        "/jit/claim",
        "",
        body,
        call_deadline(total_deadline),
    )
    value = obj(raw)
    runner = value.get("runnerName")
    jit = value.get("encodedJitConfig")
    if (
        status != 200
        or set(value) != {"operationId", "runnerName", "encodedJitConfig"}
        or value.get("operationId") != operation
        or not isinstance(runner, str)
        or not RUNNER.fullmatch(runner)
        or not isinstance(jit, str)
        or not jit
        or len(jit) > 65536
        or not jit.isascii()
        or any(ord(character) < 33 or ord(character) > 126 for character in jit)
    ):
        bad()
    return jit.encode("ascii")


def main():
    parser = FixedArgumentParser(add_help=False)
    parser.add_argument("--region", required=True)
    parser.add_argument("--claim-url", required=True)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if (
        not REGION.fullmatch(args.region)
        or not OP.fullmatch(args.operation_id)
        or not os.path.isabs(args.output)
    ):
        bad()
    material = claim(args.region, args.claim_url, args.operation_id)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(material)


def entrypoint():
    try:
        main()
    except Exception:
        sys.stderr.write("runharbor-bootstrap: secure JIT claim failed\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(entrypoint())
