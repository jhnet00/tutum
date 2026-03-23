terraform {
  backend "s3" {
    bucket         = "tutum-terraform-state-903913341620"
    key            = "staging/core-infra/terraform.tfstate"
    region         = "ap-northeast-2"
    dynamodb_table = "tutum-terraform-locks"
    encrypt        = true
  }
}
