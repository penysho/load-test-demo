#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import "source-map-support/register";
import { deployEnv, projectName } from "../config/config";
import { AppStack } from "../lib/app";
import { CiStack } from "../lib/ci";
import { ElbStack } from "../lib/elb";
import { RdsStack } from "../lib/rds";
import { VpcStack } from "../lib/vpc";

const app = new cdk.App();

const envProps = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const vpcStack = new VpcStack(app, `${projectName}-vpc-${deployEnv}`, {});

const elbStack = new ElbStack(app, `${projectName}-elb-${deployEnv}`, {
  ...envProps,
  vpcStack: vpcStack,
});

const rdsStack = new RdsStack(app, `${projectName}-rds-${deployEnv}`, {
  ...envProps,
  vpcStack: vpcStack,
});

const appStack = new AppStack(app, `${projectName}-app-${deployEnv}`, {
  ...envProps,
  vpcStack: vpcStack,
  elbStack: elbStack,
  rdsStack: rdsStack,
});

new CiStack(app, `${projectName}-ci-${deployEnv}`, {
  ...envProps,
  elbStack: elbStack,
  appStack: appStack,
});
