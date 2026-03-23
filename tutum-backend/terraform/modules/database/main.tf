resource "aws_db_subnet_group" "this" {
  name        = var.db_subnet_group_name
  description = var.db_subnet_group_description
  subnet_ids  = var.subnet_ids
}

resource "aws_db_instance" "this" {
  identifier                 = var.identifier
  db_name                    = var.db_name
  username                   = var.username
  password                   = var.password
  instance_class             = var.instance_class
  allocated_storage          = var.allocated_storage
  storage_type               = var.storage_type
  iops                       = var.iops
  storage_throughput         = var.storage_throughput
  engine                     = var.engine
  engine_version             = var.engine_version
  parameter_group_name       = var.parameter_group_name
  option_group_name          = var.option_group_name
  backup_retention_period    = var.backup_retention_period
  backup_window              = var.backup_window
  maintenance_window         = var.maintenance_window
  multi_az                   = var.multi_az
  deletion_protection        = var.deletion_protection
  auto_minor_version_upgrade = var.auto_minor_version_upgrade
  publicly_accessible        = var.publicly_accessible
  db_subnet_group_name       = aws_db_subnet_group.this.name
  vpc_security_group_ids     = var.vpc_security_group_ids
  copy_tags_to_snapshot      = false
  skip_final_snapshot        = true

  lifecycle {
    ignore_changes = [password, snapshot_identifier, final_snapshot_identifier]
  }
}
