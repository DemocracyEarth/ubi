async function main() {

  const [deployer] = await ethers.getSigners();

  console.log(
    "Deploying contracts with the account:",
    deployer.address
  );

  console.log("Account balance:", (await deployer.getBalance()).toString());

  const PohDummy = await ethers.getContractFactory("ProofOfHumanityDummy");
  console.log("Deploying POH Dummy..."); 
  const poh = await PohDummy.deploy();

  // const StreamLib = await ethers.getContractFactory("StreamLib");
  // console.log("Deploying StreamLib..."); 
  // const streamlib = await StreamLib.deploy();

  const Token = await ethers.getContractFactory("UBI");
  console.log("Deploying UBI Coin...");

  const token = await upgrades.deployProxy(
    Token,
    [
      0,
      "Ubi Delegatable",
      "UBI",
      1000,
      poh.address
    ],
    {
      initializer: 'initialize',
      unsafeAllowCustomTypes: true
    }
  );

  console.log("Token deployed to:", token.address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
