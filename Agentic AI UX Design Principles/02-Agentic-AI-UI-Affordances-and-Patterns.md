# Agentic AI UI Affordances and Patterns

**Author:** Jason Falk
**Date:** April 7, 2025
**Status:** Draft

## Introduction

Creating effective interfaces for agentic AI requires a new set of UI affordances that go beyond traditional interaction patterns. These affordances support the unique relationship between humans and autonomous agents, enabling users to guide, monitor, and collaborate with AI systems that act independently on their behalf.

Note that the necessity and prominence of specific affordances will depend on the agent's capabilities, particularly which **Core** versus **Enhancing Attributes** (from [Key Attributes](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfnPGPErW3FMgQL98sa4J1ABuLLc0us7YOIdgSo2m-_1-w?e=bMO3Dq)) are implemented. For example, an agent with high **Autonomy** and **Proactivity** will require stronger **Control and Intervention** affordances than a more reactive one.

## 1. Attention and Context Management

*Mechanisms that help users direct the agent's focus and establish shared understanding, crucial for managing **Context Awareness**. For instance, when asking an agent to analyze specific parts of a complex report, the user needs ways to clearly point to sections and see that the agent understands the focus.*

| Affordance | Description | Why It Matters (Supports Attributes) | Example |
|------------|-------------|--------------------------------------|---------|
| **Referential Pointing** | UI elements for explicitly indicating objects of focus (highlighting, circling, tagging) | Reduces ambiguity, improves **Goal Orientation**, and enhances **Context Awareness** | Highlighting text and saying "summarize this" with visual confirmation |
| **Context Visualization** | Visual representations of what the agent currently "sees" or considers relevant | Makes agent "thinking" transparent, supporting **Transparency** and **Context Awareness** | Visual indicator (e.g., subtle overlay) showing which data points on a chart are influencing the current analysis |
| **Scope Definition** | Controls for setting boundaries on agent actions (e.g., "only these files") | Prevents unwanted actions, managing **Autonomy** and **Environmental Operation** risks | Checkboxes in a dialog allowing users to specify which folders or file types to include in an agent's search operation |
| **Memory Externalization** | Interfaces making agent "memory" visible and editable | Allows correction of misunderstandings, supporting **Persistence** and **Adaptability** | An editable profile page showing key facts or preferences the agent has learned about the user |
| **Source Direction** | Mechanisms for directing the agent to different information sources | Improves efficiency and relevance, guiding **Environmental Operation** and **Context Awareness** | Toggle buttons or a dropdown menu allowing the user to switch the agent's search scope between web, local files, or specific databases |

## 2. Intent Expression and Refinement

*Tools that help users communicate goals clearly and refine the agent's understanding, enabling effective **Goal Orientation**. For example, if a user vaguely asks an agent to "plan my vacation," tools are needed to help specify destination, dates, budget, and preferences.*

| Affordance | Description | Why It Matters (Supports Attributes) | Example |
|------------|-------------|--------------------------------------|---------|
| **Goal Articulation Scaffolds** | Structured interfaces helping users express complex goals (templates, guided workflows) | Helps users formulate precise intentions for better **Goal Orientation** | Step-by-step form (wizard) that breaks down a complex data analysis request into manageable components |
| **Intent Disambiguation** | Interactive clarification mechanisms when ambiguity is detected | Prevents incorrect assumptions, enhancing **Goal Orientation** and **Adaptability** (*Avoid:* Asking clarifying questions excessively, which can cause frustration.) | Quick selection buttons or a clarification question presented by the agent when a query has multiple likely meanings |
| **Preference Capture** | Ways to indicate preferences beyond the immediate task | Enables personalized experiences, supporting **Adaptability** and **Persistence** | Rating system with attribute sliders (e.g., for style, tone) allowing nuanced preference capture |
| **Feedback Loops** | Lightweight mechanisms for quickly approving, rejecting, or refining outputs | Creates opportunities for improvement, supporting **Adaptability** and refining **Goal Orientation** | Inline accept/reject/edit buttons next to agent suggestions |

## 3. Collaborative Planning and Execution

*Interfaces supporting co-creation of plans and shared execution, essential for managing **Multi-Step Planning** and **Goal Orientation**. For example, when an agent proposes a multi-step plan to achieve a goal like "launch marketing campaign," the user needs ways to see, adjust, and track that plan.*

| Affordance | Description | Why It Matters (Supports Attributes) | Example |
|------------|-------------|--------------------------------------|---------|
| **Plan Visualization** | Clear representations of multi-step plans showing dependencies | Makes complex sequences comprehensible, supporting **Multi-Step Planning** and **Transparency** (*Avoid:* Overly complex visualizations that overwhelm the user.) | Interactive timeline or flowchart showing agent's planned tasks, dependencies, and estimated completion |
| **Branching Alternatives** | Interfaces showing different approaches the agent could take | Empowers user choice, enhancing **Transparency** and managing **Autonomy** | Side-by-side comparison cards showing two alternative task sequences with highlighted differences or expected outcomes |
| **Progress Tracking** | Visual indicators of plan execution status with time estimates | Builds confidence and manages expectations during **Multi-Step Planning** | Progress bar showing completed steps (e.g., 3 of 5) and estimated time remaining for a complex agent task |
| **Intervention Points** | Clearly marked opportunities for review before critical actions | Balances efficiency with oversight, supporting **Delegation Awareness** and user **Control** | Pause points in a plan visualization with preview/confirm options before irreversible actions like "Delete Files" or "Send Email" |

## 4. Transparency and Explainability

*Features that help users understand agent reasoning and actions, crucial for building trust and supporting the **Transparency and Explainability** attribute. For example, if an agent recommends a specific investment strategy, the user needs to understand the rationale and data behind that recommendation.*

| Affordance | Description | Why It Matters (Supports Attributes) | Example |
|------------|-------------|--------------------------------------|---------|
| **Decision Rationale** | Accessible explanations of why specific choices were made | Builds trust and allows informed overrides, key for **Transparency** and managing **Autonomy** | Expandable "Why this suggestion?" panel showing key factors or rules influencing an agent's recommendation |
| **Confidence Indicators** | Visual cues showing the agent's certainty about different aspects | Helps users gauge trust, supporting **Self-Monitoring** visibility and **Transparency** (*Avoid:* Using vague indicators or setting misleading confidence thresholds that erode trust.) | Color-coded text (green/yellow/red) or numerical scores indicating agent's confidence level, possibly with thresholds for required user verification |
| **Source Attribution** | Clear links between outputs and information sources | Creates accountability and exploration paths, vital for **Transparency** and **Environmental Operation** visibility | Inline citations ([1], [2]) with mouse-over previews or links to original web pages, documents, or database entries |
| **Alternative Exploration** | Interfaces showing other options the agent considered | Demonstrates thoroughness, enhances **Transparency**, and reveals potentially valuable alternatives | A gallery view displaying alternative designs, summaries, or solutions the agent generated but ranked lower than the primary suggestion |

## 5. Control and Intervention

*Mechanisms allowing users to guide agent behavior and intervene when needed, essential for managing **Autonomy** and ensuring user agency. For instance, if an agent is performing a large-scale file organization task, the user must have readily available means to pause or stop it if something seems wrong.*

| Affordance | Description | Why It Matters (Supports Attributes) | Example |
|------------|-------------|--------------------------------------|---------|
| **Autonomy Adjusters** | Granular controls for setting the agent's level of independence | Creates personalized balance between convenience and control, managing **Autonomy** and **Delegation Awareness** | Slider control labeled "Agent Autonomy Level" ranging from "Ask before every action" to "Act independently within goals" |
| **Override Mechanisms** | Clear, consistent ways to stop or redirect agent actions | Creates a safety net, essential for **Control** over agent **Autonomy** (*Avoid:* Hiding stop/cancel functions or making them difficult to access quickly during agent operation.) | Prominent, persistent Stop/Pause buttons for ongoing agent tasks, with options to redirect or cancel operations |
| **Guardrail Definition** | Interfaces for establishing boundaries on agent behavior | Prevents unwanted actions proactively, managing **Autonomy** and **Environmental Operation** risks | A rules editor allowing users to define conditions (e.g., "Don't modify files in X folder", "Ask before spending > $Y") |
| **Escalation Triggers** | User-defined conditions prompting the agent to seek approval | Creates intelligent interruption system, supporting **Delegation Awareness** and **Control** | Threshold settings (e.g., "Require approval for actions affecting > 10 items") that trigger confirmation dialogs |

## 6. Feedback and Learning

*Interfaces facilitating agent improvement through user feedback, supporting **Adaptability** and **Persistence**. For example, if an agent consistently misunderstands a specific type of user request, mechanisms are needed for the user to correct it and help the agent learn.*

| Affordance | Description | Why It Matters (Supports Attributes) | Example |
|------------|-------------|--------------------------------------|---------|
| **Correction Mechanisms** | Simple ways to fix mistakes that feed into future behavior | Creates virtuous cycle for **Adaptability**, improving alignment with user expectations | One-click correction options (e.g., "This was categorized incorrectly") that update the agent's internal model or knowledge |
| **Preference Learning** | Interfaces helping the agent understand reasoning behind choices | Enables generalization for **Adaptability**, improving future suggestions | Quick follow-up prompts ("Why did you prefer Option A?") after a user makes a choice between agent suggestions |
| **Performance Review** | Periodic summaries of agent actions with feedback opportunities | Creates structured review points, supporting **Adaptability** and **Self-Monitoring** visibility | Digestible weekly/monthly summary of agent activities with options for user ratings or adjustments to future behavior |
| **Teaching Interfaces** | Tools for proactively training the agent on new concepts | Accelerates **Adaptability** to new domains, giving users investment in agent development | Dedicated "Training Mode" where users can demonstrate preferred workflows or provide explicit examples/rules |

## 7. Identity and Relationship Management

*Features supporting the ongoing relationship between user and agent, leveraging **Identity Continuity** and **Persistence**. For instance, users may want to customize an agent's communication style or review past interactions to build a consistent working relationship.*

| Affordance | Description | Why It Matters (Supports Attributes) | Example |
|------------|-------------|--------------------------------------|---------|
| **Personality Calibration** | Controls for adjusting communication style and behavior | Creates more comfortable interaction, managing **Identity Continuity** | Communication style settings (e.g., Formal/Casual, Verbose/Concise sliders) in agent preferences |
| **Relationship History** | Accessible records of past interactions and outcomes | Creates continuity and reference points, leveraging **Persistence** | Searchable interaction timeline showing key decisions, agent actions, and user feedback |
| **Trust Signals** | Indicators helping users gauge when to trust recommendations | Helps users calibrate trust, supporting **Transparency** and **Self-Monitoring** visibility | Visual indicators showing agent confidence level, source reliability, or basis for recommendations (e.g., "Based on your past feedback") |
| **Boundary Setting** | Mechanisms for defining when and how the agent can engage | Allows integration on user's terms, managing **Proactivity** and **Control** | Configurable rules (e.g., Do Not Disturb hours, situations where agent should remain silent vs. suggest) |

## 8. Multi-Modal Interaction

*Support for diverse interaction methods across contexts, enhancing overall usability and **Context Awareness**. For example, a user might start a task by talking to an agent on their phone, then continue refining it via text and direct manipulation on their desktop.*

| Affordance | Description | Why It Matters (Supports Attributes) | Example |
|------------|-------------|--------------------------------------|---------|
| **Context-Aware Input Switching** | Seamless transitions between text, voice, gesture, etc. | Makes the agent accessible across situations, enhancing **Context Awareness** | Agent automatically switching between listening for voice commands and accepting touch input based on device state or environment |
| **Output Adaptation** | Intelligent selection of appropriate output format | Presents information effectively, improving **Communication** clarity | Agent dynamically switching between showing data in a table, summarizing it as text, or generating a chart based on content type and user request |
| **Environmental Awareness** | Interfaces adapting to user's current context | Creates more situationally appropriate experiences, reflecting **Context Awareness** | Agent UI simplifying automatically when detecting user is in driving mode or becoming more information-dense when on a large desktop screen |
| **Accessibility Transformations** | Automatic adaptation for different abilities | Ensures inclusivity, a key aspect of responsible design and broad **Adaptability** | Agent content automatically adjusting font size, contrast, or converting to speech based on user accessibility preferences |

## 9. Choosing the Right Affordances (Decision Aid)

Selecting the most appropriate affordances depends heavily on the context of use, the agent's capabilities (especially **Autonomy**, **Proactivity**, and **Environmental Operation**), and the potential risk associated with the agent's actions. Consider these general guidelines:

- **High Agent Autonomy or High Task Risk:** Prioritize robust **Control and Intervention** (e.g., `Override Mechanisms`, `Intervention Points`, `Guardrail Definition`) and strong **Transparency and Explainability** (e.g., `Decision Rationale`, `Action Visibility` via logs/notifications).
- **Complex, Multi-Step Tasks:** Emphasize **Collaborative Planning and Execution** (e.g., `Plan Visualization`, `Progress Tracking`) and clear **Intent Expression and Refinement** (e.g., `Goal Articulation Scaffolds`).
- **Building User Trust (Especially Early On):** Focus on **Transparency** (e.g., `Confidence Indicators`, `Source Attribution`), clear **Feedback and Learning** (e.g., `Correction Mechanisms`), and visible **Identity and Relationship Management** (e.g., `Relationship History`).
- **Collaborative Workflows:** Leverage **Attention and Context Management** (e.g., `Referential Pointing`, `Context Visualization`) and potentially **Hybrid UI Delegation** patterns (see [Agent-Application Interaction](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/ERZ6v5szfSlPigP_xcehFAUBsHxzefk1bspExPYMH9Wpyw?e=aOTWaz)).
- **Personalized/Adaptive Agents:** Ensure good **Feedback and Learning** (e.g., `Preference Learning`) and **Attention & Context** mechanisms (e.g., `Memory Externalization`).

These are starting points; designers must evaluate the specific needs of their users and tasks to select and combine affordances effectively. For more on integration approaches, see [Agent-Application Interaction](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/ERZ6v5szfSlPigP_xcehFAUBsHxzefk1bspExPYMH9Wpyw?e=aOTWaz).

## 10. Further Considerations

*Designing effective user interfaces for agentic AI involves navigating unique challenges at the intersection of interaction design, cognitive science, and AI capabilities. The following points represent complex, ongoing areas that merit deep thought, research, and experimentation by UX designers and researchers. These are not questions with simple right or wrong answers; rather, they highlight fundamental tensions and opportunities in creating interfaces that enable seamless, trustworthy, and effective human-agent collaboration. Exploring these considerations is key to developing intuitive and powerful agentic experiences.*

### Balancing Transparency of Capability and Limitation
While agents need to communicate what they *can* do, it's equally important to convey their limitations clearly to set realistic expectations and prevent misuse. How can UI affordances make both the agent's strengths *and* weaknesses transparent in a way that is easily understood without overwhelming the user or requiring deep technical knowledge?

### Communicating Complex Agent Processes
Agents may undertake complex planning or reasoning to achieve goals. How can UI patterns effectively visualize these internal processes (like planning or decision rationale) in a way that builds appropriate user trust and allows for meaningful intervention, without demanding excessive cognitive load or slowing down the interaction?

### Defining and Adjusting Task Completion
Agents need to assess when a task is "done," but the user's definition might differ or change. What UI mechanisms allow users to clearly communicate their success criteria upfront, monitor the agent's progress towards that definition, and easily adjust or override the agent's assessment of task completion?

### Designing for the Autonomy-Control Spectrum
The central tension in agentic UX is balancing AI autonomy (for efficiency) with user control (for safety and agency). How can UI affordances provide users with a fluid and intuitive way to adjust this balance dynamically, perhaps varying it based on task, context, or personal preference, without creating overly complex interfaces?

### Evolving Collaborative UI Patterns
As humans and agents work more closely together, especially within applications (see [Experiences Beyond Conversation](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EbDPCNbYqB1BmAg34j1hqycB6-DwfeBgV71ayad0E_zjOA?e=8IuyuE)), what novel UI patterns will emerge to best support this collaboration? How might interfaces move beyond simple command/response or suggestion/acceptance towards more fluid, co-creative interactions enabled by shared context and understanding?

## 11. Related Sections

- For a complete overview of all sections, see the [Overview](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EdCm_1Tnl8pBn5jf3wGTVD8BF0_PGmNaC5EJGySYrE3nIw?e=Qxg1bw)