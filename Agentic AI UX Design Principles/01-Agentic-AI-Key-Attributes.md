# Agentic AI Key Attributes

**Author:** Jason Falk
**Date:** April 7, 2025
**Status:** Draft

## Introduction

This document explores the fundamental characteristics that define truly agentic AI experiences. These attributes distinguish agentic systems from more basic AI implementations, creating experiences where AI can act independently on behalf of users while maintaining appropriate levels of user control and transparency.

Not all attributes are equally essential for a system to be considered agentic. This document distinguishes between three categories of attributes:

1. **Core attributes** that represent the minimum requirements for a system to be considered truly agentic
2. **Enhancing attributes** that significantly improve any agentic experience but aren't strictly required
3. **Contextual attributes** that become essential in specific domains or use cases but aren't universally required

This three-tier framework helps teams prioritize development efforts, evaluate whether a system meets the baseline definition of agentic AI, and determine which additional capabilities are most relevant for their specific application context.

```
                    Spectrum of Agency
  ┌───────────────────────────────────────────────────────┐
  │                                                       │
  │  Non-Agentic                                 Agentic  │
  │                                                       │
  │  ◄─────────────────────────────────────────────────►  │
  │                                                       │
  │  Reactive         Responsive         Proactive        │
  │  Stateless        Short Memory       Persistent       │
  │  Informational    Suggestive         Operational      │
  │  Command-driven   Request-driven     Goal-driven      │
  │                                                       │
  └───────────────────────────────────────────────────────┘
```

## Attribute Categories

### Core Attributes

These attributes represent the minimum requirements for a system to be considered truly agentic:

- **Autonomy:** Ability to independently make decisions and act without requiring step-by-step user guidance. *(UX Implication: Reduces user effort but requires careful design of control mechanisms and transparency to maintain user trust and comfort.)*

- **Proactivity:** Initiating actions based on inferred goals or predicted user needs without explicit prompting. *(UX Implication: Can delight users by anticipating needs but risks being intrusive or incorrect; requires context-awareness and user control over interruption levels.)*

- **Goal Orientation:** Clear pursuit and execution of user-defined objectives, maintaining focus across multiple steps. *(UX Implication: Enables completion of complex tasks but requires clear communication of the goal and progress to keep the user oriented.)*

- **Environmental Operation:** Ability to interact with and manipulate external systems, tools, and data sources autonomously. *(UX Implication: Allows agents to perform meaningful work but necessitates robust permissions, safety guardrails, and visibility into external actions.)*

- **Completion Assessment:** Ability to determine when a task is sufficiently complete and recognize the "definition of done" based on explicit or implicit success criteria. *(UX Implication: Reduces user oversight but requires alignment on success criteria and mechanisms for users to adjust or override the agent's assessment.)*

These core attributes form the foundation of agency. Without them, a system would be merely responsive rather than truly agentic. The ability to act independently (autonomy), take initiative (proactivity), maintain focus on objectives (goal orientation), affect the external world (environmental operation), and determine when goals are achieved (completion assessment) collectively enable an AI system to act as a genuine agent on behalf of users.

> **Note on Agents vs. Assistants:** The distinction between AI agents and AI assistants often hinges on the degree of autonomy and proactivity. Assistants primarily respond to user requests and require approval for actions, while agents can independently decide how to accomplish tasks within defined boundaries. Both can be valuable depending on the user needs and context.

### Enhancing Attributes

These attributes significantly improve agentic experiences but aren't strictly required for a system to be considered agentic:

- **Persistence:** Maintaining state, memory, and goals across sessions and interactions, unlike stateless LLM interactions. While an agent can function within a single session, persistence enables more sophisticated, ongoing relationships with users. *(UX Implication: Creates continuity and enables personalization but requires managing user expectations about what is remembered/forgotten and providing controls for memory management.)*

- **Adaptability:** Learning and evolving based on user interactions and maintaining this knowledge over time. *(UX Implication: Allows the agent to become more helpful and aligned with user preferences but requires transparency about learning and mechanisms for correction.)*

- **Context Awareness:** Understanding the environment, task specifics, and user state beyond the current conversation. *(UX Implication: Enables more relevant and timely assistance but requires careful handling of potentially sensitive contextual information and ways for users to guide the agent's focus.)*

- **Self-Monitoring:** Capacity to evaluate its own performance, recognize limitations, and adjust strategies accordingly. *(UX Implication: Increases agent reliability and trustworthiness but requires clear communication of limitations or uncertainties to the user.)*

- **Multi-Step Planning:** Creating and executing complex plans with multiple interdependent steps toward a larger goal. *(UX Implication: Enables tackling ambitious goals but necessitates plan visualization and intervention points for user oversight and guidance.)*

- **Delegation Awareness:** Understanding when to act independently versus when to seek user input or approval. *(UX Implication: Balances efficiency with user control but requires predictable and often customizable thresholds for seeking confirmation.)*

- **Identity Continuity:** Maintaining consistent behavior, knowledge, and "personality" across interactions, creating a sense of persistent identity. *(UX Implication: Builds rapport and predictability but requires careful design of personality attributes appropriate for the context and brand.)*

While not essential for basic agency, these enhancing attributes significantly improve the effectiveness and user experience of agentic systems. They represent more advanced capabilities that make agents more intelligent, personalized, and self-sufficient. As agentic AI matures, we expect these enhancing attributes to become increasingly common in sophisticated implementations.

### Contextual Attributes

These attributes become essential in specific domains or use cases but aren't universally required for all agentic systems:

- **Transparency and Explainability:** The ability to make decision processes and rationales clear to users. This becomes essential in regulated industries, high-stakes decisions, or when building user trust is paramount.

- **Collaborative Intelligence:** Capabilities for effective interaction with humans and other agents, including task delegation, coordination, and integration into team workflows.

- **Domain Specialization:** Deep understanding of specific knowledge domains, including specialized terminology, standards, and domain-specific reasoning patterns.

- **Ethical Alignment:** The ability to recognize ethical implications of actions and align decisions with human values and ethical frameworks. This is particularly important in healthcare, legal, financial, and other sensitive domains.

- **System Interoperability:** Capabilities for seamless integration with diverse technologies, platforms, and data sources. This becomes critical in enterprise environments or complex technical ecosystems.

The importance of these contextual attributes varies significantly based on the specific application domain and use case. For example, explainability may be critical for a medical diagnostic agent but less important for a creative writing assistant. Organizations should evaluate which contextual attributes are most relevant for their specific implementation context.

## Distinguishing Agentic from Non-Agentic AI

Not all AI-powered experiences are truly agentic. The following table highlights key differences based on the core attributes:

| Core Attribute | Non-Agentic AI | Agentic AI |
|-----------|----------------|------------|
| **Autonomy** | Requires explicit instructions for each step | Makes independent decisions within defined boundaries |
| **Proactivity** | Responds only when prompted | Can initiate actions based on context |
| **Goal Orientation** | Focused on immediate requests | Maintains focus on broader objectives across interactions |
| **Environmental Operation** | Limited to information provision | Can take actions in external systems |
| **Completion Assessment** | Completes specific commands without evaluating overall goal progress | Can determine when broader objectives have been achieved |

The presence of enhancing attributes further distinguishes basic agentic systems from more sophisticated ones:

| Enhancing Attribute | Basic Agentic AI | Advanced Agentic AI |
|-----------|----------------|------------|
| **Persistence** | Functions primarily within single sessions | Maintains context and goals across multiple sessions |
| **Adaptability** | Limited personalization | Learns and evolves based on specific user interactions |
| **Context Awareness** | Basic understanding of immediate context | Rich understanding of user, environment, and task history |
| **Self-Monitoring** | Limited ability to detect failures | Can evaluate performance and adjust strategies |
| **Multi-Step Planning** | Simple sequential actions | Complex plans with contingencies and dependencies |
| **Delegation Awareness** | Fixed thresholds for user involvement | Nuanced understanding of when to act vs. when to consult |
| **Identity Continuity** | Functional consistency | Consistent "personality" and relationship memory |

Contextual attributes vary in importance depending on the specific domain and use case:

| Contextual Attribute | Domain-Specific Implementation | When It Becomes Critical |
|-----------|----------------|------------|
| **Transparency and Explainability** | Varies from basic decision explanations to detailed reasoning traces | Regulated industries (healthcare, finance), high-stakes decisions, building user trust |
| **Collaborative Intelligence** | Ranges from simple handoffs to sophisticated team integration | Multi-agent systems, human-AI teams, complex workflows requiring coordination |
| **Domain Specialization** | From general knowledge to deep domain expertise | Specialized professional contexts (legal, medical, scientific research) |
| **Ethical Alignment** | From basic safety guardrails to nuanced ethical reasoning | Applications with potential for harm, systems making consequential decisions |
| **System Interoperability** | From limited API connections to seamless ecosystem integration | Enterprise environments, complex technical ecosystems, multi-platform deployments |

These tables illustrate how the three categories of attributes manifest differently across systems with varying levels of agency. However, it's important to recognize that these distinctions aren't always clear-cut.

> **Note on Attribute Classification:** While we've organized attributes into three distinct categories (Core, Enhancing, and Contextual), it's important to recognize that these classifications exist on a spectrum. The importance of specific attributes may shift based on application domain, user needs, and implementation context. This framework is intended as a starting point for UX designers and product teams to consider how these attributes apply to their specific scenarios, not as a rigid classification system. Teams should feel empowered to adapt this framework to their unique requirements, potentially elevating certain attributes or de-emphasizing others based on their particular use cases.

## Framework Application

This attribute framework serves as a foundation for UX designers and product teams to consider when designing agentic experiences. Rather than providing rigid classifications, it offers a structured way to think about the capabilities that contribute to agency in AI systems.

When applying this framework to specific products:

1. **Prioritize based on context:** Evaluate which attributes are most critical for your specific use case and user needs
2. **Consider domain requirements:** Some contextual attributes may become core in particular domains
3. **Balance implementation complexity:** Consider technical feasibility alongside ideal attribute implementation
4. **Focus on user value:** Prioritize attributes that deliver the most meaningful improvements to user experience

The framework's value is not in strict adherence to these categories, but in providing a comprehensive view of the attributes that contribute to agentic experiences. Understanding these attributes helps identify the specific UI affordances and interaction patterns (detailed in [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS)) required to support them effectively.

## Further Considerations

*Defining the attributes of agentic AI provides a crucial vocabulary, but understanding their deeper implications and interplay is an ongoing challenge. The following points represent complex areas related to these attributes that merit deep thought, research, and discussion among designers, researchers, and product teams. These are not questions with simple right or wrong answers; rather, they highlight fundamental dynamics and trade-offs inherent in designing systems with agency. Exploring these considerations is key to developing nuanced, responsible, and user-centered agentic experiences.*

### The Interplay and Tension Between Attributes
Agentic attributes rarely exist in isolation. How do they interact? For example, how does increasing agent **Autonomy** affect the need for **Transparency**? How might aggressive **Proactivity** conflict with user comfort or perceived control? Designing effective agents often involves navigating the inherent tensions and finding the right balance between competing attributes based on context and user needs.

### User Perception vs. Technical Reality
Users build mental models of agents based on observed behavior, which may not perfectly match the underlying technical implementation of attributes like **Adaptability**, **Self-Monitoring**, or **Context Awareness**. How can designers ensure that the *perceived* agency aligns appropriately with the agent's actual capabilities, avoiding misinterpretations that could lead to misuse or eroded trust?

### The Evolving Nature of Agency
The definition and importance of specific attributes may shift as AI technology advances and user expectations evolve. Are today's "Enhancing" attributes like **Persistence** or **Adaptability** destined to become "Core" requirements in the future? What entirely new attributes might emerge as critical for the next generation of agentic systems? Planning for this evolution is essential.

### Ethical Dimensions of Agentic Attributes
Each attribute carries potential ethical implications. Maximizing **Autonomy** raises questions about accountability. **Adaptability** can introduce concerns about bias amplification or privacy. **Persistence** creates challenges around data retention and user control over memory. How can these ethical dimensions be proactively considered and managed during the design and implementation of each attribute?

### Cultural Variations in Attribute Perception
The desirability and interpretation of attributes like **Proactivity**, **Identity Continuity** (personality), or even the appropriate level of **Autonomy** can vary significantly across different cultural contexts. How can agentic systems be designed to be sensitive to these variations, offering experiences that feel appropriate and trustworthy to a diverse global user base?

### Measuring the Intangible Attributes
While some aspects of agency might be measurable (e.g., task completion speed influenced by **Environmental Operation**), others like the quality of **Context Awareness**, the appropriateness of **Delegation Awareness**, or the degree of **Adaptability** are harder to quantify. What novel methods and metrics are needed to effectively evaluate these more nuanced attributes? (Related: [Evaluation Methods and Metrics](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/Ec1HRUkZGeRNo6GJ8-eosiIBz0HBqE_8GIWY3W9O5LT90A?e=2genRt))

## Related Sections

- For a complete overview of all sections, see the [Overview](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EdCm_1Tnl8pBn5jf3wGTVD8BF0_PGmNaC5EJGySYrE3nIw?e=Qxg1bw)
