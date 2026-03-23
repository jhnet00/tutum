output "eks_cluster_security_group_id" {
  value = aws_security_group.eks_cluster.id
}

output "monitoring_security_group_id" {
  value = aws_security_group.monitoring.id
}

output "rds_security_group_id" {
  value = aws_security_group.rds.id
}
