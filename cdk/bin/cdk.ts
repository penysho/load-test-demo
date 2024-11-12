#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import "source-map-support/register";
import { deployEnvironment, projectName } from "../config/config";
import { DbProps, Rds } from "../lib/rds";

const app = new cdk.App();

export const rdsProps: DbProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  projectName: projectName,
  deployEnvironment: deployEnvironment,
};

new Rds(app, `${projectName}-rds-${deployEnvironment}`, rdsProps);
