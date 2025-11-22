import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("Permit2TransferValidatorModule", (m) => {
  const permit2Validator = m.contract("Permit2TransferValidator");

  return { permit2Validator };
});
