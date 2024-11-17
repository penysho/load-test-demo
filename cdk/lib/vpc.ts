import { Fn, Stack, StackProps, aws_ec2 as ec2 } from "aws-cdk-lib";
import { Construct } from "constructs";
import { deployEnv } from "../config/config";

export interface VpcStackProps extends StackProps {}

/**
 * Define VPC resources.
 */
export class VpcStack extends Stack {
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props);

    // VPC
    // Read in VPCs for common use that have already been created and imported into the CDK without defining a new one.
    this.vpc = ec2.Vpc.fromVpcAttributes(this, "vpc", {
      vpcId: Fn.importValue(`shared-vpc-${deployEnv}-Vpc`),
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
