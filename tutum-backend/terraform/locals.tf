locals {
  environment  = "staging"
  project_name = "tutum"
  account_id   = "903913341620"

  ids = {
    vpc              = "vpc-07de5077a86cac33f"
    internet_gateway = "igw-03917cebd25167079"
    nat_gateway      = "nat-02d4de6a0d9b1cd72"
    nat_eip          = "eipalloc-0fd5f1e59f15c4411"

    subnets = {
      public_a  = "subnet-0937edf9855525b1b"
      public_c  = "subnet-0495c1c0ae546f02c"
      private_a = "subnet-09e82b994d4378ed4"
      private_c = "subnet-012b272e47d6e6a07"
    }

    route_tables = {
      public    = "rtb-067b7ce595275a957"
      private_a = "rtb-01c7c1a52938b5d98"
      private_c = "rtb-0999ba6ddd266fd73"
    }

    security_groups = {
      eks_cluster = "sg-0a819286b08c1162e"
      rds         = "sg-0a8c73b3ea2d26143"
      monitoring  = "sg-09bcd23950d81a5f0"
      lb_backend  = "sg-0045e72a28d17da2d"
      lb_managed  = "sg-092f6e696a1649308"
    }

    vpc_endpoints = {
      s3             = "vpce-00990c1243c6723ba"
      ecr_dkr        = "vpce-0972fed29a2e31ac5"
      ecr_api        = "vpce-06638d8d5ac9bbbd0"
      secretsmanager = "vpce-0a4b335d1f3e0bcc8"
      sts            = "vpce-0d73b7f2b20079d68"
    }

    monitoring_instance = "i-0a8cab5d5ce1cac60"
    db_subnet_group     = "tutum-rds-subnet-group"
    rds_instance        = "tutum-mariadb"
    route53_zone        = "Z04669402IT42VPHL8CRP"
    acm_certificate     = "arn:aws:acm:ap-northeast-2:903913341620:certificate/cc8731ed-bd74-4ea4-a07b-897b6fbac78d"
  }

  network = {
    vpc_cidr             = "10.60.0.0/16"
    enable_dns_support   = true
    enable_dns_hostnames = true

    subnets = {
      public_a = {
        cidr                    = "10.60.1.0/24"
        availability_zone       = "ap-northeast-2a"
        map_public_ip_on_launch = false
        tags = {
          Name                                  = "vpc-tutum-eks-stg-subnet-public1-ap-northeast-2a"
          "kubernetes.io/cluster/tutum-stg-eks" = "shared"
          "kubernetes.io/role/elb"              = "1"
        }
      }
      public_c = {
        cidr                    = "10.60.2.0/24"
        availability_zone       = "ap-northeast-2c"
        map_public_ip_on_launch = false
        tags = {
          Name                                  = "vpc-tutum-eks-stg-subnet-public2-ap-northeast-2c"
          "kubernetes.io/cluster/tutum-stg-eks" = "shared"
          "kubernetes.io/role/elb"              = "1"
        }
      }
      private_a = {
        cidr                    = "10.60.11.0/24"
        availability_zone       = "ap-northeast-2a"
        map_public_ip_on_launch = false
        tags = {
          Name                                  = "vpc-tutum-eks-stg-subnet-private1-ap-northeast-2a"
          "kubernetes.io/cluster/tutum-stg-eks" = "shared"
          "kubernetes.io/role/internal-elb"     = "1"
        }
      }
      private_c = {
        cidr                    = "10.60.12.0/24"
        availability_zone       = "ap-northeast-2c"
        map_public_ip_on_launch = false
        tags = {
          Name                                  = "vpc-tutum-eks-stg-subnet-private2-ap-northeast-2c"
          "kubernetes.io/cluster/tutum-stg-eks" = "shared"
          "kubernetes.io/role/internal-elb"     = "1"
        }
      }
    }

    igw_tags = {
      Name = "vpc-tutum-eks-stg-igw"
    }

    nat_tags = {
      Name = "vpc-tutum-eks-stg-nat-public1-ap-northeast-2a"
    }

    route_tables = {
      public = {
        tags = {
          Name = "vpc-tutum-eks-stg-rtb-public"
        }
      }
      private_a = {
        tags = {
          Name = "vpc-tutum-eks-stg-rtb-private1-ap-northeast-2a"
        }
      }
      private_c = {
        tags = {
          Name = "vpc-tutum-eks-stg-rtb-private2-ap-northeast-2c"
        }
      }
    }
  }
}
