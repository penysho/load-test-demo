import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elasticloadbalancingv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { currentEnvConfig, deployEnv, projectName } from "../config/config";
import { ElbStack } from "./elb";
import { RdsStack } from "./rds";
import { VpcStack } from "./vpc";

export interface AppStackProps extends cdk.StackProps {
  readonly vpcStack: VpcStack;
  readonly elbStack: ElbStack;
  readonly rdsStack: RdsStack;
}

/**
 * Define resources for the applications project.
 */
export class AppStack extends cdk.Stack {
  /**
   * ECR
   */
  public readonly repository: ecr.CfnRepository;
  /**
   * ECS Cluster
   */
  public readonly cluster: ecs.CfnCluster;
  /**
   * ECS Service
   */
  public readonly service: ecs.CfnService;
  /**
   * Blue Target Group
   */
  public readonly blueTargetGroup: elasticloadbalancingv2.CfnTargetGroup;
  /**
   * Green Target Group
   */
  public readonly greenTargetGroup: elasticloadbalancingv2.CfnTargetGroup;

  public constructor(scope: cdk.App, id: string, props: AppStackProps) {
    super(scope, id, props);

    const vpc = props.vpcStack.vpc;
    const publicSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC,
    });

    const containerName = "app";
    const containerPort = 8011;

    // Resources
    this.cluster = new ecs.CfnCluster(this, "Cluster", {
      clusterName: `${projectName}-${deployEnv}`,
    });
    this.cluster.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    this.blueTargetGroup = new elasticloadbalancingv2.CfnTargetGroup(
      this,
      "BlueTargetGroup",
      {
        vpcId: vpc.vpcId!,
        name: `${projectName}-${deployEnv}-blue`,
        protocol: "HTTP",
        port: containerPort,
        targetType: "ip",
        healthCheckPath: "/health",
        healthCheckPort: containerPort.toString(),
      }
    );
    this.blueTargetGroup.cfnOptions.deletionPolicy =
      cdk.CfnDeletionPolicy.DELETE;

    this.greenTargetGroup = new elasticloadbalancingv2.CfnTargetGroup(
      this,
      "GreenTargetGroup",
      {
        vpcId: vpc.vpcId!,
        name: `${projectName}-${deployEnv}-green`,
        protocol: "HTTP",
        port: containerPort,
        targetType: "ip",
        healthCheckPath: "/health",
        healthCheckPort: containerPort.toString(),
      }
    );
    this.greenTargetGroup.cfnOptions.deletionPolicy =
      cdk.CfnDeletionPolicy.DELETE;

    const logGroup = new logs.CfnLogGroup(this, "LogGroup", {
      logGroupName: `/ecs/${projectName}-${deployEnv}`,
      retentionInDays: 90,
    });
    logGroup.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    this.repository = new ecr.CfnRepository(this, "Repository", {
      repositoryName: `${projectName}-${deployEnv}`,
      lifecyclePolicy: {
        lifecyclePolicyText:
          '{"rules":[{"rulePriority":1,"description":"Expire images older than 3 generations","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":3},"action":{"type":"expire"}}]}',
      },
    });
    this.repository.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const taskExecutionRole = new iam.CfnRole(this, "TaskExecutionRole", {
      roleName: `${projectName}-${deployEnv}-task-execution-role`,
      policies: [
        {
          policyName: `${projectName}-${deployEnv}-task-execution-role-policy`,
          policyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: "s3:GetObject",
                Resource: currentEnvConfig.ecsEnvFileS3Arn,
              },
            ],
          },
        },
      ],
      managedPolicyArns: [
        "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
      ],
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: "ecs-tasks.amazonaws.com",
            },
            Action: "sts:AssumeRole",
          },
        ],
      },
    });
    taskExecutionRole.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const taskRole = new iam.CfnRole(this, "TaskRole", {
      roleName: `${projectName}-${deployEnv}-task-role`,
      policies: [
        {
          policyName: `${projectName}-${deployEnv}-task-role-policy`,
          policyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: [
                  "ssmmessages:CreateControlChannel",
                  "ssmmessages:CreateDataChannel",
                  "ssmmessages:OpenControlChannel",
                  "ssmmessages:OpenDataChannel",
                ],
                Resource: ["*"],
              },
            ],
          },
        },
      ],
      assumeRolePolicyDocument: {
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: "ecs-tasks.amazonaws.com",
            },
            Action: "sts:AssumeRole",
          },
        ],
      },
    });
    taskRole.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const metricFilterForServerError = new logs.CfnMetricFilter(
      this,
      "MetricFilterForServerError",
      {
        filterName: "server-error",
        filterPattern: "?ERROR ?error ?Error",
        logGroupName: logGroup.ref,
        metricTransformations: [
          {
            metricValue: "1",
            metricNamespace: `${projectName}-${deployEnv}`,
            metricName: `${projectName}-${deployEnv}-server-error`,
          },
        ],
      }
    );
    metricFilterForServerError.cfnOptions.deletionPolicy =
      cdk.CfnDeletionPolicy.DELETE;

    const taskDefinition = new ecs.CfnTaskDefinition(this, "TaskDefinition", {
      cpu: "256",
      taskRoleArn: taskRole.attrArn,
      executionRoleArn: taskExecutionRole.attrArn,
      family: `${projectName}-${deployEnv}`,
      memory: "512",
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      containerDefinitions: [
        {
          name: containerName,
          image: [this.repository.attrRepositoryUri, "latest"].join(":"),
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroup.ref,
              "awslogs-region": `${this.region}`,
              "awslogs-stream-prefix": "ecs",
            },
          },
          portMappings: [
            {
              hostPort: containerPort,
              protocol: "tcp",
              containerPort: containerPort,
            },
          ],
          environmentFiles: [
            {
              type: "s3",
              value: currentEnvConfig.ecsEnvFileS3Arn,
            },
          ],
        },
      ],
    });
    taskDefinition.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    this.service = new ecs.CfnService(this, "Service", {
      cluster: this.cluster.ref,
      enableExecuteCommand: true,
      launchType: "FARGATE",
      deploymentController: {
        type: "CODE_DEPLOY",
      },
      desiredCount: 1,
      loadBalancers: [
        {
          targetGroupArn: this.blueTargetGroup.ref,
          containerPort: containerPort,
          containerName: containerName,
        },
      ],
      networkConfiguration: {
        awsvpcConfiguration: {
          assignPublicIp: "ENABLED",
          securityGroups: [
            props.elbStack.ElbTargetSecurityGroup.attrGroupId,
            props.rdsStack.rdsClientSg.securityGroupId,
          ],
          subnets: publicSubnets.subnetIds,
        },
      },
      serviceName: `${projectName}-${deployEnv}-service`,
      taskDefinition: taskDefinition.ref,
    });
    this.service.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
  }
}
