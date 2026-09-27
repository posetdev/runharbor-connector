# Runners need a path to GitHub and nothing else. This VPC is created with the
# Connector and is not peered, attached to a transit gateway, or connected by
# VPN to any network the customer already runs. One public subnet per
# Availability Zone keeps a capacity miss in one zone from failing the job.
# A NAT gateway would bill while the fleet is idle, so there isn't one:
# instances take a public IPv4 from the subnet instead.
locals {
  runner_availability_zones = sort(data.aws_availability_zones.available.names)
}

data "aws_availability_zones" "available" {
  state = "available"

  # An AZ that still requires opt-in cannot accept a subnet. Leaving it in the
  # list fails apply in accounts that have not opted in, so "every AZ" here
  # means every AZ this account can actually launch into.
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

resource "aws_vpc" "runner" {
  cidr_block           = "10.64.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = local.tags
}

resource "aws_subnet" "runner" {
  for_each = { for index, az in local.runner_availability_zones : az => index }

  vpc_id                  = aws_vpc.runner.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(aws_vpc.runner.cidr_block, 8, each.value)
  map_public_ip_on_launch = true

  tags = local.tags
}

resource "aws_internet_gateway" "runner" {
  vpc_id = aws_vpc.runner.id

  tags = local.tags
}

resource "aws_route_table" "runner" {
  vpc_id = aws_vpc.runner.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.runner.id
  }

  tags = local.tags
}

# aws_route_table_association has no tags argument in this provider.
resource "aws_route_table_association" "runner" {
  for_each = aws_subnet.runner

  subnet_id      = each.value.id
  route_table_id = aws_route_table.runner.id
}

resource "aws_security_group" "runner" {
  name        = "${var.name_prefix}-runner"
  description = "RunHarbor runner instances: outbound only, no inbound"
  vpc_id      = aws_vpc.runner.id

  # GitHub-hosted runners allow every outbound port. Customer jobs commonly
  # need SSH (22), the git protocol (9418), and other non-HTTP ports; an
  # 80/443-only egress makes those jobs fail. Nothing may connect inbound.
  egress {
    description = "All outbound, matching GitHub-hosted runners"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}
