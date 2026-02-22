# Code Smells and Remedies

A catalog of code smells -- surface indicators of deeper structural problems -- with recommended refactoring remedies.

---

## Bloaters

Code that has grown excessively large and unwieldy.

### Long Method / Long Function

- **Smell:** A function exceeds 20-30 lines or handles multiple responsibilities
- **Remedy:** Extract Function, Decompose Conditional, Replace Temp with Query
- **Detection:** Line count, cyclomatic complexity > 10

### Large Class / God Class

- **Smell:** A class with too many fields, methods, or responsibilities
- **Remedy:** Extract Class, Extract Superclass, Replace Type Code with Subclasses
- **Detection:** Class LOC > 300, field count > 10, method count > 15

### Primitive Obsession

- **Smell:** Using primitive types for domain concepts (e.g., string for email, number for currency)
- **Remedy:** Replace Primitive with Object, Introduce Parameter Object, Extract Class
- **Detection:** Repeated validation logic for the same primitive type

### Long Parameter List

- **Smell:** A function takes more than 3-4 parameters
- **Remedy:** Introduce Parameter Object, Preserve Whole Object, Replace Parameter with Method
- **Detection:** Parameter count > 3

### Data Clumps

- **Smell:** Groups of data that frequently appear together across functions or classes
- **Remedy:** Extract Class, Introduce Parameter Object
- **Detection:** Same group of parameters in multiple function signatures

---

## Object-Orientation Abusers

Incorrect or incomplete application of OO principles.

### Switch Statements (Type Code Smell)

- **Smell:** Switch or if-else chains that select behavior based on object type
- **Remedy:** Replace Conditional with Polymorphism, Replace Type Code with Subclasses
- **Detection:** switch/case or if-else chains checking the same type variable

### Temporary Field

- **Smell:** Object fields that are only set in certain circumstances
- **Remedy:** Extract Class, Introduce Special Case (Null Object)
- **Detection:** Fields checked for null before use in multiple places

### Refused Bequest

- **Smell:** A subclass uses only some of the methods and properties inherited from its parents
- **Remedy:** Replace Subclass with Delegate, Replace Superclass with Delegate, Push Down Method
- **Detection:** Subclass overrides to no-op, or ignores inherited methods

### Parallel Inheritance Hierarchies

- **Smell:** Creating a subclass for one class requires creating a subclass for another
- **Remedy:** Move Method, Move Field to collapse one hierarchy into the other
- **Detection:** Naming patterns (e.g., every FooHandler has a FooFactory)

---

## Change Preventers

Smells that make code difficult to change.

### Divergent Change

- **Smell:** One class is commonly changed in different ways for different reasons
- **Remedy:** Extract Class (split by responsibility)
- **Detection:** Git history shows the same file changed for unrelated reasons

### Shotgun Surgery

- **Smell:** A single logical change requires modifying many classes
- **Remedy:** Move Method, Move Field, Inline Class (consolidate scattered logic)
- **Detection:** A single feature change touches 5+ files in unrelated areas

### Feature Envy

- **Smell:** A method accesses the data of another object more than its own
- **Remedy:** Move Method to the class whose data it uses most
- **Detection:** Method references external object fields more than its own class fields

---

## Dispensables

Code that is unnecessary and can be removed.

### Dead Code

- **Smell:** Variables, parameters, methods, or classes that are never used
- **Remedy:** Remove Dead Code
- **Detection:** Static analysis tools, IDE warnings, coverage reports
- **Agentic note:** Agent should verify with a full search before removing; dynamically-referenced code may appear dead

### Speculative Generality

- **Smell:** Abstract classes, interfaces, parameters, or methods created "just in case" but never used
- **Remedy:** Collapse Hierarchy, Inline Class, Remove Parameter
- **Detection:** Abstract classes with one implementation, parameters never passed differently

### Duplicated Code

- **Smell:** Identical or very similar code in multiple locations
- **Remedy:** Extract Function, Extract Class, Pull Up Method, Form Template Method
- **Detection:** Static analysis (PMD CPD, jsinspect, SonarQube), manual review

### Comments as Deodorant

- **Smell:** Comments that explain what confusing code does instead of the code being clear
- **Remedy:** Extract Function (name explains intent), Rename Variable/Method
- **Detection:** Inline comments explaining logic flow rather than "why"

---

## Couplers

Smells that create excessive coupling between classes.

### Inappropriate Intimacy

- **Smell:** Two classes are too familiar with each other's internal details
- **Remedy:** Move Method, Move Field, Extract Class, Hide Delegate
- **Detection:** Classes accessing private/protected members of each other

### Message Chains

- **Smell:** Client asks one object for another, then asks that for another: `a.getB().getC().getD().doSomething()`
- **Remedy:** Hide Delegate, Extract Function, Move Method
- **Detection:** Long chains of method calls navigating an object graph

### Middle Man

- **Smell:** A class delegates most of its work, adding only indirection
- **Remedy:** Inline Class, Remove Middle Man
- **Detection:** Most methods are one-line delegations

### Indecent Exposure

- **Smell:** Classes expose internal details that should be hidden
- **Remedy:** Encapsulate Field, Encapsulate Collection, Hide Delegate
- **Detection:** Public fields, mutable collection getters

---

## Agentic Smell Detection Strategy

### Automated Detection

Agents should use these approaches to identify smells:

1. **Static analysis first** -- Run linters and complexity analyzers before manual inspection
2. **Git history analysis** -- Identify churn hotspots and coupling patterns
3. **Test coverage gaps** -- Low coverage areas often harbor hidden smells
4. **Dependency analysis** -- Map import/require graphs to find coupling issues

### Prioritization for Agents

When multiple smells are detected, prioritize:

1. **Shotgun Surgery** -- Fixes here yield the highest productivity gains
2. **Duplicated Code** -- Reducing duplication prevents future divergence
3. **Long Method** -- Most impactful for readability and testability
4. **Feature Envy** -- Fixes often reveal better module boundaries
5. **Dead Code** -- Low-risk removal that reduces cognitive load

### Reporting Format

When an agent detects smells, report them in a structured format:

```markdown
## Smell Report

| File | Smell | Severity | Recommended Refactoring | Effort |
|------|-------|----------|------------------------|--------|
| OrderService.ts | Long Method (processOrder: 85 lines) | High | Extract Function | 30min |
| UserController.ts | Feature Envy (accesses OrderRepo 12x) | Medium | Move Method | 1h |
| utils/helpers.ts | Duplicated Code (3 instances of formatDate) | Medium | Extract to shared utility | 20min |
```
