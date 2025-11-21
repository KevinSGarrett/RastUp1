# orchestrator/extensions/aws_actions.py
import json, os, subprocess, tempfile, time, contextlib
from dataclasses import dataclass
from pathlib import Path

import boto3
from botocore.config import Config

@dataclass
class CloudTarget:
    account: str
    role_arn: str
    region: str

def assume_role(role_arn, region):
    sts = boto3.client("sts", region_name=region, config=Config(retries={"max_attempts": 6}))
    creds = sts.assume_role(RoleArn=role_arn, RoleSessionName="orchestrator")["Credentials"]
    return dict(
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
        region_name=region,
    )

@contextlib.contextmanager
def as_target(role_arn, region):
    env = os.environ.copy()
    creds = assume_role(role_arn, region)
    env.update(
        AWS_ACCESS_KEY_ID=creds["aws_access_key_id"],
        AWS_SECRET_ACCESS_KEY=creds["aws_secret_access_key"],
        AWS_SESSION_TOKEN=creds["aws_session_token"],
        AWS_DEFAULT_REGION=creds["region_name"],
    )
    yield env

def run(cmd, env=None, cwd=None):
    print("[aws] $", " ".join(cmd))
    return subprocess.run(cmd, cwd=cwd, env=env, check=True, text=True, capture_output=True)

def deploy_cdk(app_path: str, env: dict):
    # assumes cdk.json exists and stacks are synthesized in this path
    run(["npm", "ci"], env=env, cwd=app_path)
    run(["npx", "cdk", "bootstrap"], env=env, cwd=app_path)
    run(["npx", "cdk", "deploy", "--require-approval", "never", "--all"], env=env, cwd=app_path)

def verify_stack(stack_name: str, env: dict):
    cf = boto3.client("cloudformation", region_name=env["AWS_DEFAULT_REGION"])
    stacks = cf.describe_stacks(StackName=stack_name)["Stacks"]
    s = stacks[0]
    if s["StackStatus"] not in ("CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"):
        raise RuntimeError(f"Stack {stack_name} unhealthy: {s['StackStatus']}")

def appsync_apply_schema(api_id_file: str, schema_file: str, env: dict):
    api_id = Path(api_id_file).read_text().strip()
    schema = Path(schema_file).read_text()
    client = boto3.client("appsync", region_name=env["AWS_DEFAULT_REGION"])
    resp = client.start_schema_creation(apiId=api_id, definition=schema.encode("utf8"))
    sid = resp["asyncOperationId"]
    for _ in range(60):
        status = client.get_schema_creation_status(apiId=api_id)["status"]
        if status in ("SUCCESS", "FAILED"):
            break
        time.sleep(2)
    if status != "SUCCESS":
        raise RuntimeError(f"AppSync schema update failed: {status}")

def verify_appsync(api_id_file: str, env: dict):
    api_id = Path(api_id_file).read_text().strip()
    client = boto3.client("appsync", region_name=env["AWS_DEFAULT_REGION"])
    _ = client.get_graphql_api(apiId=api_id)
