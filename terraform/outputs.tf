output "eks_cluster" {
  value = {
    name               = data.aws_eks_cluster.staging.name
    endpoint           = data.aws_eks_cluster.staging.endpoint
    cluster_sg_id      = data.aws_eks_cluster.staging.vpc_config[0].cluster_security_group_id
    private_subnet_ids = data.aws_eks_cluster.staging.vpc_config[0].subnet_ids
  }
}

output "networking" {
  value = {
    vpc_id     = module.networking.vpc_id
    subnet_ids = module.networking.subnet_ids
    endpoints  = module.networking.vpc_endpoint_ids
  }
}

output "monitoring_instance" {
  value = {
    instance_id = module.compute.instance_id
    private_ip  = module.compute.private_ip
  }
}

output "database" {
  value = {
    identifier = module.database.db_instance_id
    endpoint   = module.database.db_endpoint
  }
}

output "dns" {
  value = {
    zone_id         = module.dns.zone_id
    certificate_arn = module.dns.certificate_arn
  }
}
