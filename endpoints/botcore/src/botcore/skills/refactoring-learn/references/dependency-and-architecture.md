# Dependency Inversion and Architecture Refactoring

Patterns for reducing coupling, inverting dependencies, and restructuring module boundaries.

---

## SOLID Principles in Refactoring Context

### Single Responsibility Principle (SRP)

**Refactoring signal:** A class or module changes for more than one reason.

```typescript
// BEFORE: Handles both data access and formatting
class UserReport {
  getUsers(): User[] { /* SQL query */ }
  formatAsCSV(users: User[]): string { /* CSV logic */ }
  formatAsPDF(users: User[]): Buffer { /* PDF logic */ }
  sendEmail(report: string, to: string): void { /* SMTP logic */ }
}

// AFTER: Each class has one reason to change
class UserRepository {
  getUsers(): User[] { /* SQL query */ }
}

class CSVFormatter {
  format(users: User[]): string { /* CSV logic */ }
}

class PDFFormatter {
  format(users: User[]): Buffer { /* PDF logic */ }
}

class ReportMailer {
  send(report: string, to: string): void { /* SMTP logic */ }
}
```

### Open-Closed Principle (OCP)

**Refactoring signal:** Adding a new variant requires modifying existing code.

```typescript
// BEFORE: Must modify this function for each new shape
function calculateArea(shape: Shape): number {
  switch (shape.type) {
    case 'circle': return Math.PI * shape.radius ** 2;
    case 'rectangle': return shape.width * shape.height;
    // Adding triangle requires changing this function
  }
}

// AFTER: New shapes extend without modifying existing code
interface Shape {
  area(): number;
}

class Circle implements Shape {
  constructor(private radius: number) {}
  area(): number { return Math.PI * this.radius ** 2; }
}

class Rectangle implements Shape {
  constructor(private width: number, private height: number) {}
  area(): number { return this.width * this.height; }
}
```

### Dependency Inversion Principle (DIP)

**Refactoring signal:** High-level modules import low-level modules directly.

```typescript
// BEFORE: High-level policy depends on low-level detail
import { MySQLDatabase } from './mysql-database';

class OrderService {
  private db = new MySQLDatabase();

  async createOrder(order: Order): Promise<void> {
    await this.db.query('INSERT INTO orders ...', order);
  }
}

// AFTER: Both depend on abstraction
interface OrderRepository {
  save(order: Order): Promise<void>;
  findById(id: string): Promise<Order | null>;
}

class OrderService {
  constructor(private repository: OrderRepository) {}

  async createOrder(order: Order): Promise<void> {
    await this.repository.save(order);
  }
}

// Low-level detail implements the abstraction
class MySQLOrderRepository implements OrderRepository {
  async save(order: Order): Promise<void> {
    await this.db.query('INSERT INTO orders ...', order);
  }

  async findById(id: string): Promise<Order | null> {
    return this.db.query('SELECT * FROM orders WHERE id = ?', id);
  }
}
```

### Interface Segregation Principle (ISP)

**Refactoring signal:** Clients are forced to depend on interfaces they do not use.

```typescript
// BEFORE: Fat interface forces unnecessary implementations
interface Worker {
  work(): void;
  eat(): void;
  sleep(): void;
}

class Robot implements Worker {
  work() { /* ... */ }
  eat() { throw new Error('Robots do not eat'); }  // Forced to implement
  sleep() { throw new Error('Robots do not sleep'); }  // Forced to implement
}

// AFTER: Segregated interfaces
interface Workable { work(): void; }
interface Feedable { eat(): void; }
interface Restable { sleep(): void; }

class Robot implements Workable {
  work() { /* ... */ }
}

class Human implements Workable, Feedable, Restable {
  work() { /* ... */ }
  eat() { /* ... */ }
  sleep() { /* ... */ }
}
```

### Liskov Substitution Principle (LSP)

**Refactoring signal:** Subclass breaks the contract of its parent, causing callers to check types.

- If you find `instanceof` checks for specific subclasses, LSP is likely violated
- Remedy: Replace Subclass with Delegate, or restructure the hierarchy

---

## Dependency Injection Refactoring

### Constructor Injection (Preferred)

```typescript
// Make dependencies explicit and injectable
class NotificationService {
  constructor(
    private emailClient: EmailClient,
    private smsClient: SMSClient,
    private logger: Logger
  ) {}

  async notify(user: User, message: string): Promise<void> {
    if (user.preferences.email) {
      await this.emailClient.send(user.email, message);
    }
    if (user.preferences.sms) {
      await this.smsClient.send(user.phone, message);
    }
    this.logger.info('Notification sent', { userId: user.id });
  }
}
```

### Refactoring Toward DI

Steps to introduce dependency injection into tightly coupled code:

1. **Identify the dependency** -- Find `new` statements or direct module imports of implementations
2. **Extract the interface** -- Define what the dependency provides
3. **Inject via constructor** -- Accept the abstraction as a constructor parameter
4. **Create a factory or container** -- Wire up concrete implementations at the composition root
5. **Update tests** -- Replace real dependencies with test doubles

---

## Module Boundary Refactoring

### Signs of Poor Module Boundaries

- **Circular dependencies** -- Module A imports B, B imports A
- **Leaky abstractions** -- Internal types exported and used by external modules
- **God modules** -- One module that everything depends on
- **Scattered cohesion** -- Related functionality spread across many modules

### Restructuring Strategies

#### Introduce Facade

Create a public API surface that hides internal module structure:

```typescript
// internal/pricing/index.ts -- The module's public facade
export { calculatePrice } from './calculator';
export { applyDiscount } from './discounts';
export type { PriceResult, DiscountRule } from './types';

// Internal details are NOT exported:
// - ./calculator/strategies
// - ./discounts/rules-engine
// - ./types/internal
```

#### Break Circular Dependencies

```
// BEFORE: Circular
A --> B --> A

// Strategy 1: Extract shared dependency
A --> C <-- B

// Strategy 2: Dependency inversion
A --> InterfaceB <-- B
     (A depends on abstraction, B implements it)

// Strategy 3: Event-based decoupling
A --publishes--> EventBus --subscribes--> B
```

#### Layered Architecture Enforcement

Define allowed dependency directions and enforce them:

```
Presentation --> Application --> Domain <-- Infrastructure
     |                                        |
     +-----------> Infrastructure <-----------+

Rules:
- Domain NEVER imports from Application, Presentation, or Infrastructure
- Application NEVER imports from Presentation
- Infrastructure implements Domain interfaces (DIP)
```

---

## Legacy Modernization Patterns

### Introduce Adapter

Wrap legacy APIs with modern interfaces:

```typescript
// Legacy API with procedural style
function legacyCreateUser(name: string, email: string, role: number): number {
  // Returns user ID or -1 on error
}

// Modern adapter
class UserServiceAdapter implements UserService {
  async createUser(dto: CreateUserDTO): Promise<User> {
    const roleCode = this.mapRole(dto.role);
    const id = legacyCreateUser(dto.name, dto.email, roleCode);
    if (id === -1) {
      throw new UserCreationError('Failed to create user');
    }
    return { id: String(id), ...dto };
  }

  private mapRole(role: UserRole): number {
    const mapping: Record<UserRole, number> = {
      admin: 1, editor: 2, viewer: 3
    };
    return mapping[role] ?? 3;
  }
}
```

### Anti-Corruption Layer

Prevent legacy concepts from leaking into modern code:

```typescript
// Anti-corruption layer translates between legacy and modern domains
class OrderTranslator {
  fromLegacy(legacyOrder: LegacyOrderRecord): Order {
    return {
      id: String(legacyOrder.ORD_ID),
      customer: this.customerTranslator.fromLegacy(legacyOrder.CUST_REC),
      items: legacyOrder.ITEMS.map(i => this.itemTranslator.fromLegacy(i)),
      status: this.mapStatus(legacyOrder.STATUS_CD),
      createdAt: this.parseDate(legacyOrder.CRT_DT),
    };
  }

  toLegacy(order: Order): LegacyOrderRecord {
    return {
      ORD_ID: Number(order.id),
      CUST_REC: this.customerTranslator.toLegacy(order.customer),
      ITEMS: order.items.map(i => this.itemTranslator.toLegacy(i)),
      STATUS_CD: this.reverseMapStatus(order.status),
      CRT_DT: this.formatDate(order.createdAt),
    };
  }
}
```

---

## Automated Tools for Architecture Refactoring

### Codemods

Programmatic AST-based transformations for large-scale changes:

| Tool | Language | Use Case |
|------|----------|----------|
| **jscodeshift** | JavaScript/TypeScript | API migration, pattern replacement |
| **ts-morph** | TypeScript | Type-aware refactoring |
| **Rector** | PHP | Automated PHP upgrades |
| **Scalafix** | Scala | Linting and rewriting |
| **Bowler** | Python | Safe Python refactoring |
| **OpenRewrite** | Java | Automated Java/Spring migrations |

### Example: jscodeshift Codemod

```javascript
// Codemod to replace deprecated API calls
// old: import { oldFetch } from 'legacy-http';
// new: import { fetch } from 'modern-http';
module.exports = function(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  // Find and replace import source
  root.find(j.ImportDeclaration, { source: { value: 'legacy-http' } })
    .forEach(path => {
      path.node.source.value = 'modern-http';
      // Rename imported identifiers
      path.node.specifiers.forEach(spec => {
        if (spec.imported.name === 'oldFetch') {
          spec.imported.name = 'fetch';
        }
      });
    });

  return root.toSource();
};
```

### Agentic Considerations for Codemods

- Agent can generate codemods for repetitive refactoring patterns
- Always dry-run the codemod first and review the diff
- Agent should run tests after applying the codemod
- Codemods are preferable to manual refactoring for changes touching 10+ files
