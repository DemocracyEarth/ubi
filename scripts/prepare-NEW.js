async function main() {
  const proxyAddress = '';

  const UBIv2 = await ethers.getContractFactory("UBI");
  console.log("Preparing upgrade...");
  const UBIv2Address = await upgrades.prepareUpgrade(proxyAddress, UBIv2, { unsafeAllowCustomTypes: true });
  console.log("UBIv2 at:", UBIv2Address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });