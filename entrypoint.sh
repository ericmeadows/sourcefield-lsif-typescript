#!/bin/sh
output_file=${OUTPUT_FILE:-lsif-output.json}
skip=${SKIP:-False}

lsif-typescript index \
    --explicit-implicit-loop \
    --output="$output_file" \
    --skip="$skip"
