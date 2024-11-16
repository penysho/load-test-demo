import {
  Duration,
  Stack,
  StackProps,
  aws_ec2 as ec2,
  aws_rds as rds,
  aws_secretsmanager as sm,
} from "aws-cdk-lib";
import { SubnetType } from "aws-cdk-lib/aws-ec2";

import { Construct } from "constructs";
import { VpcStack } from "./vpc";
import path = require("path");

export interface RdsStackProps extends StackProps {
  projectName: string;
  deployEnvironment: string;
  vpcStack: VpcStack;
}

export class RdsStack extends Stack {
  constructor(scope: Construct, id: string, props: RdsStackProps) {
    super(scope, id, props);

    const auroraPostgresVersion = "16.2";
    const ec2InstanceType = "t3.medium";
    const EXCLUDE_CHARACTERS = "\"@'%$#&().,{_?<≠^>[:;`+*!]}=~|¥/\\";

    // VPC
    const vpc = props.vpcStack.vpc;
    const privateSubnets = vpc.selectSubnets({
      subnetType: SubnetType.PRIVATE_WITH_EGRESS,
    });
    const publicSubnets = vpc.selectSubnets({
      subnetType: SubnetType.PUBLIC,
    });

    /**
     * Security Group for RDS client
     */
    const rdsClientSg = new ec2.SecurityGroup(this, `RdsClientSg`, {
      vpc,
      securityGroupName: `${props.projectName}-${props.deployEnvironment}-rds-client`,
      description: `${props.projectName}-${props.deployEnvironment} RDS Client Security Group.`,
      allowAllOutbound: true,
    });

    /**
     * Security Group for RDS Secrets rotate
     */
    const rdsRotateSecretsSg = new ec2.SecurityGroup(
      this,
      `RdsRotateSecretsSg`,
      {
        vpc,
        securityGroupName: `${props.projectName}-${props.deployEnvironment}-rds-rotate-secrets`,
        description: `${props.projectName}-${props.deployEnvironment} RDS Secrets rotate Security Group.`,
        allowAllOutbound: true,
      }
    );

    /**
     * Security Group for RDS Proxy
     */
    const rdsProxySg = new ec2.SecurityGroup(this, `RdsProxySg`, {
      vpc,
      securityGroupName: `${props.projectName}-${props.deployEnvironment}-rds-proxy`,
      description: `${props.projectName}-${props.deployEnvironment} RDS Proxy Security Group.`,
      allowAllOutbound: true,
    });
    rdsProxySg.addIngressRule(
      ec2.Peer.securityGroupId(rdsClientSg.securityGroupId),
      ec2.Port.tcp(5432)
    );

    /**
     * Security Group for RDS
     */
    const rdsSg = new ec2.SecurityGroup(this, `RdsSg`, {
      vpc,
      securityGroupName: `${props.projectName}-${props.deployEnvironment}-rds`,
      description: `${props.projectName}-${props.deployEnvironment} RDS Instance Security Group.`,
      allowAllOutbound: true,
    });
    rdsSg.addIngressRule(
      ec2.Peer.securityGroupId(rdsClientSg.securityGroupId),
      ec2.Port.tcp(5432)
    );
    rdsSg.addIngressRule(
      ec2.Peer.securityGroupId(rdsRotateSecretsSg.securityGroupId),
      ec2.Port.tcp(5432)
    );
    rdsSg.addIngressRule(
      ec2.Peer.securityGroupId(rdsProxySg.securityGroupId),
      ec2.Port.tcp(5432)
    );

    /**
     * RDS Admin User Secret
     */
    const rdsAdminSecret = new sm.Secret(this, `RdsAdminSecret`, {
      secretName: `${props.projectName}-${props.deployEnvironment}/rds/admin-secret`,
      description: `${props.projectName}-${props.deployEnvironment} RDS Admin User Secret.`,
      generateSecretString: {
        excludeCharacters: EXCLUDE_CHARACTERS,
        generateStringKey: "password",
        passwordLength: 32,
        requireEachIncludedType: true,
        secretStringTemplate: '{"username": "postgresAdmin"}',
      },
    });

    /**
     * RDS Subnet Group
     */
    const subnetGroup = new rds.SubnetGroup(this, `SubnetGroup`, {
      description: `The subnet group to be used by Aurora in ${props.projectName}-${props.deployEnvironment}.`,
      vpc,
      subnetGroupName: `${props.projectName}-${props.deployEnvironment}`,
      // 開発環境向けにパブリックアクセス可能にする
      vpcSubnets: publicSubnets,
    });

    /**
     * RDS Parameter Group
     */
    const auroraPostgresMajorVersion = auroraPostgresVersion.split(".")[0];
    const parameterGroupName = `${props.projectName}-${props.deployEnvironment}`;
    const parameterGroup = new rds.ParameterGroup(this, `ParameterGroup`, {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of(
          auroraPostgresVersion,
          auroraPostgresMajorVersion
        ),
      }),
      description: `${props.projectName}-${props.deployEnvironment} Parameter group for aurora-postgresql.`,
    });
    parameterGroup.bindToInstance({});
    const cfnParameterGroup = parameterGroup.node
      .defaultChild as rds.CfnDBParameterGroup;
    cfnParameterGroup.addPropertyOverride(
      "DBParameterGroupName",
      parameterGroupName
    );

    /**
     * RDS Cluster
     */
    const [instanceClass, instanceSize] = ec2InstanceType.split(".");
    const rdsCluster = new rds.DatabaseCluster(this, `RdsCluster`, {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of(
          auroraPostgresVersion,
          auroraPostgresMajorVersion
        ),
      }),
      credentials: rds.Credentials.fromSecret(rdsAdminSecret),
      clusterIdentifier: `${props.projectName}-${props.deployEnvironment}-cluster`,
      deletionProtection: false,
      iamAuthentication: true,
      readers: [
        rds.ClusterInstance.provisioned(`Reader1`, {
          instanceIdentifier: `${props.projectName}-${props.deployEnvironment}-reader-1`,
          instanceType: ec2.InstanceType.of(
            instanceClass as ec2.InstanceClass,
            instanceSize as ec2.InstanceSize
          ),
          // 開発環境向けにパブリックアクセス可能にする
          publiclyAccessible: true,
          parameterGroup,
        }),
      ],
      securityGroups: [rdsSg],
      storageEncrypted: true,
      subnetGroup,
      vpc,
      writer: rds.ClusterInstance.provisioned(`Writer`, {
        instanceIdentifier: `${props.projectName}-${props.deployEnvironment}-writer`,
        instanceType: ec2.InstanceType.of(
          instanceClass as ec2.InstanceClass,
          instanceSize as ec2.InstanceSize
        ),
        // 開発環境向けにパブリックアクセス可能にする
        publiclyAccessible: true,
        parameterGroup,
      }),
    });

    /**
     * RDS Secret rotation
     */
    new sm.SecretRotation(this, `DbAdminSecretRotation`, {
      application: sm.SecretRotationApplication.POSTGRES_ROTATION_SINGLE_USER,
      secret: rdsAdminSecret,
      target: rdsCluster,
      vpc,
      automaticallyAfter: Duration.days(3),
      excludeCharacters: EXCLUDE_CHARACTERS,
      securityGroup: rdsRotateSecretsSg,
      vpcSubnets: privateSubnets,
    });
  }
}