const text = `Detailed step-by-step phases mapping out exactly how to execute the change. Use Phase names and show flow transitions:
Phase 1: Foundation and Schema Definition -> Phase 2: Introduce Abstraction Layer -> Phase 3: Implement PostgreSQL Persistence -> Phase 4: Integration and Data Migration -> Phase 5: Final Cleanup

---

### **Phase 1: Foundation and Schema Definition**
Goal: Prepare the environment and define the target state in PostgreSQL without altering existing application code. This phase is non-disruptive.

* 1.1. Schema Definition: ...`;

const phaseRegex = /^###\s*(?:\*\*)?\s*(Phase\s*\d+[^:\n*]*)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*(.*?)(?:\*\*)?\s*$/gmi;
const matches = [...text.matchAll(phaseRegex)];
console.log("Matches:", matches.length);
if (matches.length > 0) {
    console.log("Match 1:", matches[0][1]);
    console.log("Match 2:", matches[0][2]);
}
