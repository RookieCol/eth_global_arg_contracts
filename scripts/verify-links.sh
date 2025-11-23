#!/bin/bash

echo "🔍 Verifying Validator Contracts on All Chains..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Contract addresses
OP_VALIDATOR="0x68cf7E02984eC410F785fE14C47D5af2b2b87f06"
BASE_VALIDATOR="0x07b091cC0eef5b03A41eB4bDD059B388cd3560D1"
ARB_VALIDATOR="0xbD57b37FEf0fda7151a0C0BdA957aE37BD84ab6B"

echo "📋 Validator Addresses:"
echo "  OP Sepolia:  $OP_VALIDATOR"
echo "  Base Sepolia: $BASE_VALIDATOR"
echo "  Arb Sepolia:  $ARB_VALIDATOR"
echo ""

echo "🔗 Verification Links:"
echo ""
echo "${BLUE}OP Sepolia:${NC}"
echo "  https://sepolia-optimism.etherscan.io/address/$OP_VALIDATOR#code"
echo ""
echo "${BLUE}Base Sepolia:${NC}"
echo "  https://sepolia.basescan.org/address/$BASE_VALIDATOR#code"
echo ""
echo "${BLUE}Arbitrum Sepolia:${NC}"
echo "  https://sepolia.arbiscan.io/address/$ARB_VALIDATOR#code"
echo ""

