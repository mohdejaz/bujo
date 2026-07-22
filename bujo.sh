#!/bin/sh

export BUJO_DB=./bujo.db
python3 bujo.py "$@"
