variable "ami" { type = string }
variable "instance_type" { type = string }
variable "subnet_id" { type = string }
variable "private_ip" { type = string }
variable "iam_instance_profile" { type = string }
variable "vpc_security_group_ids" { type = list(string) }
variable "tags" { type = map(string) }
