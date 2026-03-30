describe("node config inputNames", () => {
  it("matches the ordered input-handle field names for built-in nodes", async () => {
    (globalThis as any).window = {
      askiDesktop: undefined,
    };

    const { nodeConfigs } = await import(
      "../../../src/nodes-configuration/nodeConfig"
    );

    const mismatches = Object.entries(nodeConfigs)
      .filter(([, config]) => !!config)
      .map(([processorType, config]) => {
        const expectedInputNames = config!.fields
          .filter((field) => field.hasHandle)
          .map((field) => field.name);
        const actualInputNames = config!.inputNames ?? [];

        return {
          processorType,
          expectedInputNames,
          actualInputNames,
        };
      })
      .filter(
        ({ expectedInputNames, actualInputNames }) =>
          JSON.stringify(expectedInputNames) !== JSON.stringify(actualInputNames),
      );

    expect(mismatches).toEqual([]);
  });
});
