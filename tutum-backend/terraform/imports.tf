import {
  to = module.networking.aws_vpc.this
  id = local.ids.vpc
}

import {
  to = module.networking.aws_subnet.public_a
  id = local.ids.subnets.public_a
}

import {
  to = module.networking.aws_subnet.public_c
  id = local.ids.subnets.public_c
}

import {
  to = module.networking.aws_subnet.private_a
  id = local.ids.subnets.private_a
}

import {
  to = module.networking.aws_subnet.private_c
  id = local.ids.subnets.private_c
}

import {
  to = module.networking.aws_internet_gateway.this
  id = local.ids.internet_gateway
}

import {
  to = module.networking.aws_eip.nat
  id = local.ids.nat_eip
}

import {
  to = module.networking.aws_nat_gateway.this
  id = local.ids.nat_gateway
}

import {
  to = module.networking.aws_route_table.public
  id = local.ids.route_tables.public
}

import {
  to = module.networking.aws_route_table.private_a
  id = local.ids.route_tables.private_a
}

import {
  to = module.networking.aws_route_table.private_c
  id = local.ids.route_tables.private_c
}

import {
  to = module.networking.aws_route.public_default
  id = "${local.ids.route_tables.public}_0.0.0.0/0"
}

import {
  to = module.networking.aws_route.private_a_default
  id = "${local.ids.route_tables.private_a}_0.0.0.0/0"
}

import {
  to = module.networking.aws_route.private_c_default
  id = "${local.ids.route_tables.private_c}_0.0.0.0/0"
}

import {
  to = module.networking.aws_route_table_association.public_a
  id = "${local.ids.subnets.public_a}/${local.ids.route_tables.public}"
}

import {
  to = module.networking.aws_route_table_association.public_c
  id = "${local.ids.subnets.public_c}/${local.ids.route_tables.public}"
}

import {
  to = module.networking.aws_route_table_association.private_a
  id = "${local.ids.subnets.private_a}/${local.ids.route_tables.private_a}"
}

import {
  to = module.networking.aws_route_table_association.private_c
  id = "${local.ids.subnets.private_c}/${local.ids.route_tables.private_c}"
}

import {
  to = module.networking.aws_vpc_endpoint.s3
  id = local.ids.vpc_endpoints.s3
}

import {
  to = module.networking.aws_vpc_endpoint.ecr_dkr
  id = local.ids.vpc_endpoints.ecr_dkr
}

import {
  to = module.networking.aws_vpc_endpoint.ecr_api
  id = local.ids.vpc_endpoints.ecr_api
}

import {
  to = module.networking.aws_vpc_endpoint.secretsmanager
  id = local.ids.vpc_endpoints.secretsmanager
}

import {
  to = module.networking.aws_vpc_endpoint.sts
  id = local.ids.vpc_endpoints.sts
}

import {
  to = module.security.aws_security_group.eks_cluster
  id = local.ids.security_groups.eks_cluster
}

import {
  to = module.security.aws_security_group.rds
  id = local.ids.security_groups.rds
}

import {
  to = module.security.aws_security_group.monitoring
  id = local.ids.security_groups.monitoring
}

import {
  to = module.compute.aws_instance.monitoring
  id = local.ids.monitoring_instance
}

import {
  to = module.database.aws_db_subnet_group.this
  id = local.ids.db_subnet_group
}

import {
  to = module.database.aws_db_instance.this
  id = local.ids.rds_instance
}

import {
  to = module.dns.aws_route53_zone.this
  id = local.ids.route53_zone
}

import {
  to = module.dns.aws_acm_certificate.this
  id = local.ids.acm_certificate
}
