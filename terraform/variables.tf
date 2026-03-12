variable "region" {
  description = "AWS region for the staging infrastructure."
  type        = string
  default     = "ap-northeast-2"
}

variable "db_password" {
  description = "Optional MariaDB master password used only when Terraform needs to modify the imported RDS instance."
  type        = string
  sensitive   = true
  default     = null
}
