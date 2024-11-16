#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import "source-map-support/register";
import { deployEnv, projectName } from "../config/config";
import { RdsStack } from "../lib/rds";
import { VpcStack } from "../lib/vpc";

const app = new cdk.App();

const vpcStack = new VpcStack(app, `${projectName}-vpc-${deployEnv}`, {});

new RdsStack(app, `${projectName}-rds-${deployEnv}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  vpcStack: vpcStack,
});
