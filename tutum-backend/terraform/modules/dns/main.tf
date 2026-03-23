resource "aws_route53_zone" "this" {
  name          = var.zone_name
  comment       = var.zone_comment
  force_destroy = false
}

resource "aws_acm_certificate" "this" {
  domain_name               = var.certificate_domain_name
  validation_method         = "DNS"
  subject_alternative_names = var.certificate_sans

  options {
    certificate_transparency_logging_preference = "ENABLED"
  }

  lifecycle {
    create_before_destroy = true
  }
}
