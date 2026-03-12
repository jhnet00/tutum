variable "vpc_cidr" { type = string }
variable "enable_dns_support" { type = bool }
variable "enable_dns_hostnames" { type = bool }
variable "nat_eip_allocation_id" { type = string }
variable "interface_endpoint_sg_ids" { type = list(string) }
variable "igw_tags" { type = map(string) }
variable "nat_tags" { type = map(string) }
variable "route_tables" {
  type = map(object({
    tags = map(string)
  }))
}
variable "subnets" {
  type = map(object({
    cidr                    = string
    availability_zone       = string
    map_public_ip_on_launch = bool
    tags                    = map(string)
  }))
}
