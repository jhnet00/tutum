variable "db_subnet_group_name" { type = string }
variable "db_subnet_group_description" { type = string }
variable "subnet_ids" { type = list(string) }
variable "identifier" { type = string }
variable "db_name" { type = string }
variable "username" { type = string }
variable "password" {
  type      = string
  default   = null
  sensitive = true
}
variable "instance_class" { type = string }
variable "allocated_storage" { type = number }
variable "storage_type" { type = string }
variable "iops" { type = number }
variable "storage_throughput" { type = number }
variable "engine" { type = string }
variable "engine_version" { type = string }
variable "parameter_group_name" { type = string }
variable "option_group_name" { type = string }
variable "backup_retention_period" { type = number }
variable "backup_window" { type = string }
variable "maintenance_window" { type = string }
variable "multi_az" { type = bool }
variable "deletion_protection" { type = bool }
variable "auto_minor_version_upgrade" { type = bool }
variable "publicly_accessible" { type = bool }
variable "vpc_security_group_ids" { type = list(string) }
