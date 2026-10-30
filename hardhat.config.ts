import "dotenv/config";
import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox";

// The cloned Safe repo lives under contracts/; only compile it when imported by contracts/test/SafeImports.sol.
subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(async (_, __, runSuper) => {
  const paths: string[] = await runSuper();
  return paths.filter((p) => !p.split("\\").join("/").includes("/safe-smart-account/"));
});

const { DEPLOYER_PRIVATE_KEY, AMOY_RPC_URL, POLYGONSCAN_API_KEY, FORK, FORK_BLOCK_NUMBER } = process.env;
const rpc = AMOY_RPC_URL || "https://polygon-amoy-bor-rpc.publicnode.com";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  networks: {
    hardhat: FORK
      ? { chainId: 80002, forking: { url: rpc, ...(FORK_BLOCK_NUMBER ? { blockNumber: Number(FORK_BLOCK_NUMBER) } : {}) } }
      : {},
    amoy: {
      url: rpc,
      chainId: 80002,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: POLYGONSCAN_API_KEY || "",
    customChains: [
      {
        network: "amoy",
        chainId: 80002,
        urls: { apiURL: "https://api.etherscan.io/v2/api?chainid=80002", browserURL: "https://amoy.polygonscan.com" },
      },
    ],
  },
  sourcify: { enabled: false },
};

export default config;
