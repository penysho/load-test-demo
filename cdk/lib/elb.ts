import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elasticloadbalancingv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as route53 from "aws-cdk-lib/aws-route53";
import { currentEnvConfig, deployEnv, projectName } from "../config/config";
import { VpcStack } from "./vpc";

export interface ElbStackProps extends cdk.StackProps {
  readonly vpcStack: VpcStack;
}

/**
 * Define ALB resources for generic use in applications.
 */
export class ElbStack extends cdk.Stack {
  /**
   * This is the ARN of the ALB for applications.
   */
  public readonly LoadBalancer: elasticloadbalancingv2.CfnLoadBalancer;
  /**
   * Listener ARN for port 80 used by ALB in applications.
   */
  public readonly Elb80Listener: elasticloadbalancingv2.CfnListener;
  /**
   * Listener ARN for port 443 used by ALB in applications.
   */
  public readonly Elb443Listener: elasticloadbalancingv2.CfnListener;
  /**
   * This is the group ID of the security group for the ALB target of applications.
   */
  public readonly GreenListener: elasticloadbalancingv2.CfnListener;
  /**
   * This is the ARN of the listener for the Green environment used in the ALB of applications.
   */
  public readonly ElbTargetSecurityGroup: ec2.CfnSecurityGroup;

  public constructor(scope: cdk.App, id: string, props: ElbStackProps) {
    super(scope, id, props);

    const vpc = props.vpcStack.vpc;
    const publicSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC,
    });

    // Resources
    const ElbSecurityGroup = new ec2.CfnSecurityGroup(
      this,
      "ElbSecurityGroup",
      {
        groupDescription:
          "This security group is allowed in the security group of the resource set in the Target Group.",
        groupName: `${projectName}-${deployEnv}-elb`,
        vpcId: vpc.vpcId!,
      }
    );
    ElbSecurityGroup.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    this.ElbTargetSecurityGroup = new ec2.CfnSecurityGroup(
      this,
      "ElbTargetSecurityGroup",
      {
        groupDescription:
          "This security group allows interaction with the ELBs set up in the target group. It is also allowed in the security group of the RDS to which the connection target is connected.",
        groupName: `${projectName}-${deployEnv}-elb-target`,
        securityGroupIngress: [
          {
            sourceSecurityGroupId: ElbSecurityGroup.attrGroupId,
            ipProtocol: "-1",
          },
        ],
        vpcId: vpc.vpcId!,
      }
    );
    this.ElbTargetSecurityGroup.cfnOptions.deletionPolicy =
      cdk.CfnDeletionPolicy.DELETE;

    this.LoadBalancer = new elasticloadbalancingv2.CfnLoadBalancer(
      this,
      "LoadBalancer",
      {
        name: `${projectName}-${deployEnv}`,
        ipAddressType: "ipv4",
        type: "application",
        scheme: "internet-facing",
        loadBalancerAttributes: [
          {
            key: "deletion_protection.enabled",
            value: "false",
          },
          {
            key: "idle_timeout.timeout_seconds",
            value: "60",
          },
        ],
        securityGroups: [
          ElbSecurityGroup.ref,
          currentEnvConfig.defaultElbSecurityGroupId,
        ],
        subnets: publicSubnets.subnetIds!,
      }
    );
    this.LoadBalancer.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    this.Elb443Listener = new elasticloadbalancingv2.CfnListener(
      this,
      "Elb443Listener",
      {
        defaultActions: [
          {
            fixedResponseConfig: {
              contentType: "text/plain",
              statusCode: "403",
            },
            type: "fixed-response",
          },
        ],
        loadBalancerArn: this.LoadBalancer.ref,
        port: 443,
        protocol: "HTTPS",
        certificates: [
          {
            certificateArn: currentEnvConfig.certificateArn,
          },
        ],
      }
    );
    this.Elb443Listener.cfnOptions.deletionPolicy =
      cdk.CfnDeletionPolicy.DELETE;

    this.Elb80Listener = new elasticloadbalancingv2.CfnListener(
      this,
      "Elb80Listener",
      {
        defaultActions: [
          {
            fixedResponseConfig: {
              contentType: "text/plain",
              statusCode: "403",
            },
            type: "fixed-response",
          },
        ],
        loadBalancerArn: this.LoadBalancer.ref,
        port: 80,
        protocol: "HTTP",
      }
    );
    this.Elb80Listener.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    this.GreenListener = new elasticloadbalancingv2.CfnListener(
      this,
      "GreenListener",
      {
        defaultActions: [
          {
            fixedResponseConfig: {
              contentType: "text/plain",
              statusCode: "403",
            },
            type: "fixed-response",
          },
        ],
        loadBalancerArn: this.LoadBalancer.ref,
        port: 10443,
        protocol: "HTTP",
      }
    );
    this.GreenListener.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const RecordSet = new route53.CfnRecordSet(this, "RecordSet", {
      name: "load-test-api.pesh-igpjt.com",
      hostedZoneId: currentEnvConfig.hostedZoneId,
      type: "A",
      aliasTarget: {
        dnsName: this.LoadBalancer.attrDnsName,
        hostedZoneId: this.LoadBalancer.attrCanonicalHostedZoneId,
      },
    });
    RecordSet.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
  }
}
