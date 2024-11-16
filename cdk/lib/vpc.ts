import { Fn, Stack, StackProps, aws_ec2 as ec2 } from "aws-cdk-lib";
import { Construct } from "constructs";
import { deployEnv } from "../config/config";

export interface VpcStackProps extends StackProps {}

export class VpcStack extends Stack {
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props);

    // VPC
    // https://docs.aws.amazon.com/cdk/v2/guide/tokens.html
    // Fn.importValueでは、返却されるのは値を指すトークンのため、fromVpcAttributesを利用する
    this.vpc = ec2.Vpc.fromVpcAttributes(this, "vpc", {
      vpcId: Fn.importValue(`shared-vpc-${deployEnv}-Vpc`),
      // 動的に指定不可かつデプロイ環境ごとに共通のため直接指定する
      availabilityZones: ["ap-northeast-1a", "ap-northeast-1c"],
      publicSubnetIds: [
        Fn.importValue(`shared-vpc-${deployEnv}-PublicSubnet1`),
        Fn.importValue(`shared-vpc-${deployEnv}-PublicSubnet2`),
      ],
      privateSubnetIds: [
        Fn.importValue(`shared-vpc-${deployEnv}-PrivateSubnet1`),
        Fn.importValue(`shared-vpc-${deployEnv}-PrivateSubnet2`),
      ],
    });
  }
}
