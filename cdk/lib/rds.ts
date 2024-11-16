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
import { deployEnv, projectName } from "../config/config";
import { VpcStack } from "./vpc";

export interface RdsStackProps extends StackProps {
  vpcStack: VpcStack;
}

export class RdsStack extends Stack {
  constructor(scope: Construct, id: string, props: RdsStackProps) {
    super(scope, id, props);

    const auroraPostgresVersion = "16.2";
    const ec2InstanceType = "t3.medium";
    const EXCLUDE_CHARACTERS = "\"@'%$#&().,{_?<≠^>[:;`+*!]}=~|¥/\\";

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
      securityGroupName: `${projectName}-${deployEnv}-rds-client`,
      description: `${projectName}-${deployEnv} RDS Client Security Group.`,
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
        securityGroupName: `${projectName}-${deployEnv}-rds-rotate-secrets`,
        description: `${projectName}-${deployEnv} RDS Secrets rotate Security Group.`,
        allowAllOutbound: true,
      }
    );

    /**
     * Security Group for RDS Proxy
     */
    const rdsProxySg = new ec2.SecurityGroup(this, `RdsProxySg`, {
      vpc,
      securityGroupName: `${projectName}-${deployEnv}-rds-proxy`,
      description: `${projectName}-${deployEnv} RDS Proxy Security Group.`,
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
      securityGroupName: `${projectName}-${deployEnv}-rds`,
      description: `${projectName}-${deployEnv} RDS Instance Security Group.`,
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
      secretName: `${projectName}-${deployEnv}/rds/admin-secret`,
      description: `${projectName}-${deployEnv} RDS Admin User Secret.`,
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
      description: `The subnet group to be used by Aurora in ${projectName}-${deployEnv}.`,
      vpc,
      subnetGroupName: `${projectName}-${deployEnv}`,
      // 開発環境向けにパブリックアクセス可能にする
      vpcSubnets: publicSubnets,
    });

    /**
     * RDS Parameter Group
     */
    const auroraPostgresMajorVersion = auroraPostgresVersion.split(".")[0];
    const parameterGroupName = `${projectName}-${deployEnv}`;
    const parameterGroup = new rds.ParameterGroup(this, `ParameterGroup`, {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.of(
          auroraPostgresVersion,
          auroraPostgresMajorVersion
        ),
      }),
      description: `${projectName}-${deployEnv} Parameter group for aurora-postgresql.`,
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
      clusterIdentifier: `${projectName}-${deployEnv}-cluster`,
      deletionProtection: false,
      iamAuthentication: true,
      readers: [
        rds.ClusterInstance.provisioned(`Reader1`, {
          instanceIdentifier: `${projectName}-${deployEnv}-reader-1`,
          instanceType: ec2.InstanceType.of(
            instanceClass as ec2.InstanceClass,
            instanceSize as ec2.InstanceSize
          ),
          // Make publicly accessible for development environments.
          publiclyAccessible: true,
          parameterGroup,
        }),
      ],
      securityGroups: [rdsSg],
      storageEncrypted: true,
      subnetGroup,
      vpc,
      writer: rds.ClusterInstance.provisioned(`Writer`, {
        instanceIdentifier: `${projectName}-${deployEnv}-writer`,
        instanceType: ec2.InstanceType.of(
          instanceClass as ec2.InstanceClass,
          instanceSize as ec2.InstanceSize
        ),
        // Make publicly accessible for development environments.
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
