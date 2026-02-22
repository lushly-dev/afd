# Refactoring Catalog

Comprehensive catalog of refactoring operations organized by category, based on Martin Fowler's catalog with modern extensions for agentic workflows.

---

## Extract Patterns

Extract patterns isolate a piece of functionality into its own unit, reducing complexity and improving reuse.

### Extract Function / Method

**When:** A code fragment can be grouped together and given a meaningful name.

```typescript
// BEFORE: Inline logic makes the function hard to follow
function printOwing(invoice: Invoice) {
  let outstanding = 0;
  for (const o of invoice.orders) {
    outstanding += o.amount;
  }

  // print details
  console.log(`name: ${invoice.customer}`);
  console.log(`amount: ${outstanding}`);
}

// AFTER: Extracted functions with clear intent
function printOwing(invoice: Invoice) {
  const outstanding = calculateOutstanding(invoice);
  printDetails(invoice, outstanding);
}

function calculateOutstanding(invoice: Invoice): number {
  return invoice.orders.reduce((sum, o) => sum + o.amount, 0);
}

function printDetails(invoice: Invoice, outstanding: number) {
  console.log(`name: ${invoice.customer}`);
  console.log(`amount: ${outstanding}`);
}
```

**Agentic safety:** Verify all local variables used in the extracted block are passed as parameters or accessible in the new scope. Run tests after extraction.

### Extract Variable

**When:** A complex expression is hard to understand.

```typescript
// BEFORE
if (order.quantity * order.itemPrice - Math.max(0, order.quantity - 500) * order.itemPrice * 0.05 > 1000) { ... }

// AFTER
const basePrice = order.quantity * order.itemPrice;
const quantityDiscount = Math.max(0, order.quantity - 500) * order.itemPrice * 0.05;
const totalPrice = basePrice - quantityDiscount;
if (totalPrice > 1000) { ... }
```

### Extract Class

**When:** A class is doing work that should be done by two classes. Look for subsets of data and methods that go together.

```typescript
// BEFORE: Person class has telephone-related behavior mixed in
class Person {
  name: string;
  officeAreaCode: string;
  officeNumber: string;

  getTelephoneNumber() {
    return `(${this.officeAreaCode}) ${this.officeNumber}`;
  }
}

// AFTER: Telephone behavior extracted to its own class
class TelephoneNumber {
  areaCode: string;
  number: string;

  toString() {
    return `(${this.areaCode}) ${this.number}`;
  }
}

class Person {
  name: string;
  officeTelephone: TelephoneNumber;

  getTelephoneNumber() {
    return this.officeTelephone.toString();
  }
}
```

### Extract Superclass

**When:** Two classes have similar features. Create a superclass and move the common features to it.

### Extract Interface

**When:** Multiple clients use the same subset of a class's interface, or two classes have part of their interfaces in common.

---

## Inline Patterns

Inline patterns are the inverse of extract -- they simplify by removing unnecessary indirection.

### Inline Function

**When:** A function's body is as clear as its name, or the indirection is needless.

```typescript
// BEFORE: Unnecessary indirection
function moreThanFiveLateDeliveries(driver: Driver): boolean {
  return driver.numberOfLateDeliveries > 5;
}
function getRating(driver: Driver): number {
  return moreThanFiveLateDeliveries(driver) ? 2 : 1;
}

// AFTER: Inlined for clarity
function getRating(driver: Driver): number {
  return driver.numberOfLateDeliveries > 5 ? 2 : 1;
}
```

### Inline Variable

**When:** A variable name says no more than the expression itself.

### Inline Class

**When:** A class is no longer doing enough to justify its existence. Move all its features into another class and delete it.

---

## Move Patterns

Move patterns relocate functionality to where it logically belongs.

### Move Function

**When:** A function references elements in other contexts more than the one it currently resides in.

**Agentic safety:** Update all callers. Use IDE-level rename/move tools when available to catch all references. Verify with a full grep for the old location.

### Move Field

**When:** A field is used more by another class than the class on which it is defined.

### Move Statements into Function

**When:** Repetitive code executed alongside a function call should become part of the function.

### Move Statements to Callers

**When:** Common behavior used by callers no longer makes sense inside the function. The inverse of Move Statements into Function.

---

## Rename Patterns

Rename patterns improve code readability without changing behavior.

### Rename Variable

**When:** A variable name does not clearly communicate its purpose.

### Rename Function / Change Function Declaration

**When:** The name of a function does not communicate its purpose, or the parameter list needs updating.

**Agentic safety:** This is the single most common agentic refactoring (studies show ~30% of agent refactorings are renames). Use language server rename (F2) when available for guaranteed correctness across all references.

### Rename Field

**When:** A field name does not clearly communicate its purpose.

---

## Simplify Conditional Logic

### Decompose Conditional

**When:** A complicated conditional (if-then-else) makes it hard to see what's happening.

```typescript
// BEFORE
if (date.before(SUMMER_START) || date.after(SUMMER_END)) {
  charge = quantity * winterRate + winterServiceCharge;
} else {
  charge = quantity * summerRate;
}

// AFTER
if (isSummer(date)) {
  charge = summerCharge(quantity);
} else {
  charge = winterCharge(quantity);
}
```

### Consolidate Conditional Expression

**When:** A sequence of conditional checks yields the same result. Combine into a single expression and extract it.

### Replace Nested Conditional with Guard Clauses

**When:** A function has complex conditional behavior that makes the normal path of execution unclear.

```typescript
// BEFORE: Nested conditionals
function getPayAmount(employee: Employee): number {
  let result: number;
  if (employee.isSeparated) {
    result = separatedAmount();
  } else {
    if (employee.isRetired) {
      result = retiredAmount();
    } else {
      result = normalPayAmount();
    }
  }
  return result;
}

// AFTER: Guard clauses
function getPayAmount(employee: Employee): number {
  if (employee.isSeparated) return separatedAmount();
  if (employee.isRetired) return retiredAmount();
  return normalPayAmount();
}
```

### Replace Conditional with Polymorphism

**When:** A conditional selects different behavior depending on the type of an object.

### Introduce Special Case (Null Object)

**When:** Many users of a data structure check for a specific value (usually null), and then most of them do the same thing.

---

## Organize Data

### Replace Primitive with Object

**When:** A data item needs additional behavior or data beyond what a primitive can offer.

```typescript
// BEFORE: Primitive obsession
function createOrder(customer: string, priority: string) { ... }

// AFTER: Rich domain objects
class Priority {
  constructor(private value: string) {
    if (!['low', 'normal', 'high', 'rush'].includes(value)) {
      throw new Error(`Invalid priority: ${value}`);
    }
  }
  higherThan(other: Priority): boolean { ... }
}

function createOrder(customer: Customer, priority: Priority) { ... }
```

### Introduce Parameter Object

**When:** Groups of parameters frequently travel together across functions.

```typescript
// BEFORE: Repeated parameter group
function amountInvoiced(startDate: Date, endDate: Date) { ... }
function amountReceived(startDate: Date, endDate: Date) { ... }
function amountOverdue(startDate: Date, endDate: Date) { ... }

// AFTER: Parameter object
class DateRange {
  constructor(public start: Date, public end: Date) {}
  contains(date: Date): boolean { ... }
}

function amountInvoiced(range: DateRange) { ... }
function amountReceived(range: DateRange) { ... }
function amountOverdue(range: DateRange) { ... }
```

### Encapsulate Variable

**When:** Widely accessed data needs a gate to monitor and control access.

### Encapsulate Collection

**When:** A getter returns a collection directly, allowing external mutation.

### Change Value to Reference / Change Reference to Value

**When:** Deciding whether an object should be shared (reference) or independently owned (value).

---

## Dealing with Inheritance

### Replace Subclass with Delegate

**When:** Inheritance is used for variation but causes coupling issues. Delegation provides more flexibility.

### Replace Superclass with Delegate

**When:** The subclass is not a proper specialization of the superclass.

### Pull Up Method / Push Down Method

**When:** Methods exist on subclasses that do the same or different things and need to be consolidated or separated.

### Collapse Hierarchy

**When:** A superclass and subclass are no longer different enough to be worth keeping separate.

---

## Refactoring APIs

### Separate Query from Modifier

**When:** A function both returns a value and has side effects. Split it so the query is side-effect-free.

### Parameterize Function

**When:** Two functions carry out very similar logic with different literal values.

### Remove Flag Argument

**When:** A function has a boolean argument that alters its behavior. Replace with explicit functions.

```typescript
// BEFORE: Flag argument
function setDimension(name: string, value: number, isMetric: boolean) { ... }

// AFTER: Explicit functions
function setHeightInCm(value: number) { ... }
function setHeightInInches(value: number) { ... }
```

### Preserve Whole Object

**When:** Getting several values from an object and passing them individually to a function. Pass the whole object instead.

---

## Composing Refactorings

### Split Phase

**When:** Code is dealing with two different things in one phase. Separate into distinct phases with clear data transfer between them.

### Combine Functions into Class

**When:** A group of functions operate heavily on the same data. Bundle them into a class.

### Combine Functions into Transform

**When:** Groups of derived data need to be calculated from source data. Use a transform function that enriches the data.

### Replace Loop with Pipeline

**When:** A loop contains multiple operations. Replace with collection pipeline methods (map, filter, reduce).

```typescript
// BEFORE: Loop doing multiple things
const results: string[] = [];
for (const person of people) {
  if (person.age >= 18) {
    results.push(person.name.toUpperCase());
  }
}

// AFTER: Pipeline
const results = people
  .filter(p => p.age >= 18)
  .map(p => p.name.toUpperCase());
```
