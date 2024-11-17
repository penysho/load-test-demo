import * as cdk from "aws-cdk-lib";
import * as codedeploy from "aws-cdk-lib/aws-codedeploy";
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

  public constructor(scope: cdk.App, id: string, props: AppStackProps) {
    super(scope, id, props);

    const vpc = props.vpcStack.vpc;
    const publicSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC,
    });

    const containerName = "app";
    const containerPort = 8011;

    // Resources
    const cluster = new ecs.CfnCluster(this, "Cluster", {
      clusterName: `${projectName}-${deployEnv}`,
    });
    cluster.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const blueTargetGroup = new elasticloadbalancingv2.CfnTargetGroup(
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
    blueTargetGroup.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const greenTargetGroup = new elasticloadbalancingv2.CfnTargetGroup(
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
    greenTargetGroup.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const logGroup = new logs.CfnLogGroup(this, "LogGroup", {
      logGroupName: `/ecs/${projectName}-${deployEnv}`,
      retentionInDays: 90,
    });
    logGroup.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;

    this.repository = new ecr.CfnRepository(this, "Repository", {
      repositoryName: `${projectName}-${deployEnv}`,
      lifecyclePolicy: {
        lifecyclePolicyText:
          '{"rules":[{"rulePriority":1,"description":"Expire images older than 3 generations","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":3},"action":{"type":"expire"}}]}',
      },
    });
    this.repository.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;

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

    const service = new ecs.CfnService(this, "Service", {
      cluster: cluster.ref,
      enableExecuteCommand: true,
      launchType: "FARGATE",
      deploymentController: {
        type: "CODE_DEPLOY",
      },
      desiredCount: 1,
      loadBalancers: [
        {
          targetGroupArn: blueTargetGroup.ref,
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
    service.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const codeDeploy = new codedeploy.CfnApplication(this, "CodeDeploy", {
      applicationName: `${projectName}-${deployEnv}`,
      computePlatform: "ECS",
    });

    const codeDeployServiceRole = new iam.CfnRole(
      this,
      "CodeDeployServiceRole",
      {
        roleName: `${projectName}-${deployEnv}-codedeploy-service-role`,
        managedPolicyArns: ["arn:aws:iam::aws:policy/AWSCodeDeployRoleForECS"],
        assumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: "codedeploy.amazonaws.com",
              },
              Action: "sts:AssumeRole",
            },
          ],
        },
      }
    );
    codeDeployServiceRole.cfnOptions.deletionPolicy =
      cdk.CfnDeletionPolicy.DELETE;

    const deploymentGroup = new codedeploy.CfnDeploymentGroup(
      this,
      "DeploymentGroup",
      {
        applicationName: codeDeploy.ref,
        autoRollbackConfiguration: {
          enabled: true,
          events: ["DEPLOYMENT_FAILURE"],
        },
        blueGreenDeploymentConfiguration: {
          deploymentReadyOption: {
            actionOnTimeout: "STOP_DEPLOYMENT",
            waitTimeInMinutes: 30,
          },
          terminateBlueInstancesOnDeploymentSuccess: {
            action: "TERMINATE",
            terminationWaitTimeInMinutes: 30,
          },
        },
        deploymentConfigName: "CodeDeployDefault.ECSAllAtOnce",
        deploymentGroupName: `${projectName}-${deployEnv}-group1`,
        deploymentStyle: {
          deploymentOption: "WITH_TRAFFIC_CONTROL",
          deploymentType: "BLUE_GREEN",
        },
        ecsServices: [
          {
            clusterName: cluster.ref,
            serviceName: service.attrName,
          },
        ],
        loadBalancerInfo: {
          targetGroupPairInfoList: [
            {
              targetGroups: [
                {
                  name: blueTargetGroup.attrTargetGroupName,
                },
                {
                  name: greenTargetGroup.attrTargetGroupName,
                },
              ],
              prodTrafficRoute: {
                listenerArns: [props.elbStack.Elb443Listener.attrListenerArn],
              },
              testTrafficRoute: {
                listenerArns: [props.elbStack.GreenListener.attrListenerArn],
              },
            },
          ],
        },
        serviceRoleArn: codeDeployServiceRole.attrArn,
      }
    );
  }
}
