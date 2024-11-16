#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import "source-map-support/register";
import { deployEnvironment, projectName } from "../config/config";
import { RdsStack, RdsStackProps } from "../lib/rds";
import { VpcStack } from "../lib/vpc";

const app = new cdk.App();

const vpcStack = new VpcStack(app, `${projectName}-vpc-${deployEnvironment}`, {
  deployEnvironment: deployEnvironment,
});

export const rdsStackProps: RdsStackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  projectName: projectName,
  deployEnvironment: deployEnvironment,
  vpcStack: vpcStack,
};

new RdsStack(app, `${projectName}-rds-${deployEnvironment}`, rdsStackProps);
