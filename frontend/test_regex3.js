const regex = /^###\s*(?:\*\*)?\s*(Phase\s*\d+[^:\-\n*]*)(?:\*\*)?\s*[:\-]?\s*(?:\*\*)?\s*(.*?)(?:\*\*)?\s*$/gmi;

const tests = [
  "### Phase 1: Foundation",
  "### **Phase 1: Foundation**",
  "### **Phase 1**: **Foundation**",
  "### Phase 1 - Foundation",
  "### **Phase 1** - Foundation",
];

for (const t of tests) {
  const match = [...t.matchAll(regex)];
  console.log(t, "->", match.length > 0 ? match[0][1] + " | " + match[0][2] : "FAIL");
}
