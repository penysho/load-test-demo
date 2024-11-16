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
 * Define ALB resources for generic use in ECS Platform applications.
 */
export class ElbStack extends cdk.Stack {
  /**
   * This is the ARN of the ALB for ECS Platform applications.
   */
  public readonly LoadBalancerArn;
  /**
   * Listener ARN for port 80 used by ALB in ECS Platform applications.
   */
  public readonly Elb80ListenerArn;
  /**
   * Listener ARN for port 443 used by ALB in ECS Platform applications.
   */
  public readonly Elb443ListenerArn;
  /**
   * This is the ARN of the listener for the Green environment used in the ALB of ECS Platform applications.
   */
  public readonly GreenListenerArn;

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

    const ElbTargetSecurityGroup = new ec2.CfnSecurityGroup(
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
    ElbTargetSecurityGroup.cfnOptions.deletionPolicy =
      cdk.CfnDeletionPolicy.DELETE;

    const LoadBalancer = new elasticloadbalancingv2.CfnLoadBalancer(
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
    LoadBalancer.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const Elb443Listener = new elasticloadbalancingv2.CfnListener(
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
        loadBalancerArn: LoadBalancer.ref,
        port: 443,
        protocol: "HTTPS",
        certificates: [
          {
            certificateArn: currentEnvConfig.certificateArn,
          },
        ],
      }
    );
    Elb443Listener.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const Elb80Listener = new elasticloadbalancingv2.CfnListener(
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
        loadBalancerArn: LoadBalancer.ref,
        port: 80,
        protocol: "HTTP",
      }
    );
    Elb80Listener.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const GreenListener = new elasticloadbalancingv2.CfnListener(
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
        loadBalancerArn: LoadBalancer.ref,
        port: 10443,
        protocol: "HTTP",
      }
    );
    GreenListener.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const RecordSet = new route53.CfnRecordSet(this, "RecordSet", {
      name: "load-test-api.pesh-igpjt.com",
      hostedZoneId: currentEnvConfig.hostedZoneId,
      type: "A",
      aliasTarget: {
        dnsName: LoadBalancer.attrDnsName,
        hostedZoneId: LoadBalancer.attrCanonicalHostedZoneId,
      },
    });
    RecordSet.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    // Outputs
    this.LoadBalancerArn = LoadBalancer.ref;
    new cdk.CfnOutput(this, "CfnOutputLoadBalancerArn", {
      key: "LoadBalancerArn",
      description: "This is the ARN of the ALB for ECS Platform applications.",
      exportName: `${this.stackName}-LoadBalancerArn`,
      value: this.LoadBalancerArn!.toString(),
    });
    this.Elb80ListenerArn = Elb80Listener.ref;
    new cdk.CfnOutput(this, "CfnOutputElb80ListenerArn", {
      key: "Elb80ListenerArn",
      description:
        "Listener ARN for port 80 used by ALB in ECS Platform applications.",
      exportName: `${this.stackName}-Elb80ListenerArn`,
      value: this.Elb80ListenerArn!.toString(),
    });
    this.Elb443ListenerArn = Elb443Listener.ref;
    new cdk.CfnOutput(this, "CfnOutputElb443ListenerArn", {
      key: "Elb443ListenerArn",
      description:
        "Listener ARN for port 443 used by ALB in ECS Platform applications.",
      exportName: `${this.stackName}-Elb443ListenerArn`,
      value: this.Elb443ListenerArn!.toString(),
    });
    this.GreenListenerArn = GreenListener.ref;
    new cdk.CfnOutput(this, "CfnOutputGreenListenerArn", {
      key: "GreenListenerArn",
      description:
        "This is the ARN of the listener for the Green environment used in the ALB of ECS Platform applications.",
      exportName: `${this.stackName}-GreenListenerArn`,
      value: this.GreenListenerArn!.toString(),
    });
  }
}
