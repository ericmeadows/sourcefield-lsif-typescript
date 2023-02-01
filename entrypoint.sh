#!/bin/sh
output_file=${OUTPUT_FILE:-lsif-output.json}
skip=${SKIP:-False}

git config --global --add safe.directory ${GITHUB_WORKSPACE}
lsif-typescript index \
    --explicit-implicit-loop \
    --output="$output_file" \
    --skip="$skip"
