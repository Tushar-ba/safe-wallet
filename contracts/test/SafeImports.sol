// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0 <0.9.0;

// Test-only: pulls the Safe sources from the cloned repo so local tests can deploy them.
import {Safe} from "../safe-smart-account/contracts/Safe.sol";
import {SafeProxyFactory} from "../safe-smart-account/contracts/proxies/SafeProxyFactory.sol";
import {CompatibilityFallbackHandler} from "../safe-smart-account/contracts/handler/CompatibilityFallbackHandler.sol";
