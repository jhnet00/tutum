data "aws_eks_cluster" "staging" {
  name = "tutum-stg-eks"
}

module "networking" {
  source = "./modules/networking"

  vpc_cidr                  = local.network.vpc_cidr
  enable_dns_support        = local.network.enable_dns_support
  enable_dns_hostnames      = local.network.enable_dns_hostnames
  subnets                   = local.network.subnets
  igw_tags                  = local.network.igw_tags
  nat_tags                  = local.network.nat_tags
  route_tables              = local.network.route_tables
  nat_eip_allocation_id     = local.ids.nat_eip
  interface_endpoint_sg_ids = [local.ids.security_groups.eks_cluster]
}

module "security" {
  source = "./modules/security"

  vpc_id                  = module.networking.vpc_id
  eks_cluster_name        = "eks-cluster-sg-tutum-stg-eks-1483106172"
  eks_cluster_description = "EKS created security group applied to ENI that is attached to EKS Control Plane master nodes, as well as any managed workloads."
  eks_cluster_tags = {
    Name                                  = "eks-cluster-sg-tutum-stg-eks-1483106172"
    "kubernetes.io/cluster/tutum-stg-eks" = "owned"
  }
  monitoring_name        = "tutum-monitoring-sg"
  monitoring_description = "Monitoring EC2 (Grafana/Loki/Tempo/Mimir/InfluxDB)"
  rds_name               = "tutum-rds-sg"
  rds_description        = "RDS MariaDB - allow EKS cluster SG"
  load_balancer_sg_ids   = [local.ids.security_groups.lb_backend, local.ids.security_groups.lb_managed]
}

module "compute" {
  source = "./modules/compute"

  ami                    = "ami-0ecfdfd1c8ae01aec"
  instance_type          = "m5.large"
  subnet_id              = module.networking.subnet_ids.private_a
  private_ip             = "10.60.11.95"
  iam_instance_profile   = "TutumMonitoringProfile"
  vpc_security_group_ids = [module.security.monitoring_security_group_id]
  tags = {
    Name    = "tutum-monitoring"
    Project = "tutum"
  }
}

module "database" {
  source = "./modules/database"

  db_subnet_group_name        = local.ids.db_subnet_group
  db_subnet_group_description = "Tutum RDS private subnets"
  subnet_ids                  = [module.networking.subnet_ids.private_a, module.networking.subnet_ids.private_c]

  identifier                 = local.ids.rds_instance
  db_name                    = "team3"
  username                   = "tutum_admin"
  password                   = var.db_password
  instance_class             = "db.t3.micro"
  allocated_storage          = 20
  storage_type               = "gp3"
  iops                       = 3000
  storage_throughput         = 125
  engine                     = "mariadb"
  engine_version             = "10.11.15"
  parameter_group_name       = "default.mariadb10.11"
  option_group_name          = "default:mariadb-10-11"
  backup_retention_period    = 7
  backup_window              = "17:48-18:18"
  maintenance_window         = "mon:13:52-mon:14:22"
  multi_az                   = true
  deletion_protection        = true
  auto_minor_version_upgrade = true
  publicly_accessible        = false
  vpc_security_group_ids     = [module.security.rds_security_group_id]
}

module "dns" {
  source = "./modules/dns"

  zone_name               = "tutum.my"
  zone_comment            = "tutum domain for service"
  certificate_domain_name = "*.tutum.my"
  certificate_sans        = ["tutum.my"]
}
