#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import "source-map-support/register";
import { deployEnvironment, projectName } from "../config/config";
import { DbProps, Rds } from "../lib/rds";
import { Vpc } from "../lib/vpc";

const app = new cdk.App();

const vpcStack = new Vpc(app, `${projectName}-vpc-${deployEnvironment}`, {
  deployEnvironment: deployEnvironment,
});

export const rdsProps: DbProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  projectName: projectName,
  deployEnvironment: deployEnvironment,
  vpcStack: vpcStack,
};

new Rds(app, `${projectName}-rds-${deployEnvironment}`, rdsProps);
