output "vpc_id" {
  value = aws_vpc.this.id
}

output "subnet_ids" {
  value = {
    public_a  = aws_subnet.public_a.id
    public_c  = aws_subnet.public_c.id
    private_a = aws_subnet.private_a.id
    private_c = aws_subnet.private_c.id
  }
}

output "vpc_endpoint_ids" {
  value = {
    s3             = aws_vpc_endpoint.s3.id
    ecr_dkr        = aws_vpc_endpoint.ecr_dkr.id
    ecr_api        = aws_vpc_endpoint.ecr_api.id
    secretsmanager = aws_vpc_endpoint.secretsmanager.id
    sts            = aws_vpc_endpoint.sts.id
  }
}
