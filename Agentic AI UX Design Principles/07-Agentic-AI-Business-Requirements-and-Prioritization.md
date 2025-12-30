# Agentic AI Business Requirements and Prioritization

**Author:** Jason Falk
**Date:** April 7, 2025
**Status:** Draft

## Introduction

When implementing agentic AI features, product designers face two key questions: (1) what capabilities need to be built, and (2) in what order should they be implemented? This document addresses these questions by providing a comprehensive business requirements catalog and an implementation prioritization framework, grounding these needs in the goal of creating effective and trustworthy user experiences.

## 1. Business Requirements Catalog

To successfully implement agentic AI attributes, organizations must establish specific business requirements that enable these capabilities while addressing organizational needs and supporting a positive user experience:

### Autonomy Requirements
*To enable agents to act independently in a way that users trust and find helpful, clear boundaries, permissions, and oversight mechanisms are essential.*
- **Delegated Authority Framework:** Define clear boundaries of what actions the agent can take without user approval (Supports `Autonomy Adjusters` affordance from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS))
- **Permission Hierarchy:** Establish tiered permission levels for different agent actions based on risk/impact (Supports granular `Control` affordances from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS))
- **Audit Trail System:** Record all autonomous actions for accountability and transparency (Supports `Action Visibility` and `Relationship History` affordances from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS); supports `Transparency` from [Trust and Safety](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfucRQOGB8BIupS9Co4BOVIB5qjm-oHZXqaM8lELci52hg?e=X5IaB6))
- **Fallback Protocols:** Define when and how the agent should escalate to human intervention (Crucial for safety and `Error Handling` UX; relates to [Trust and Safety](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfucRQOGB8BIupS9Co4BOVIB5qjm-oHZXqaM8lELci52hg?e=X5IaB6))

### Persistence Requirements
*Persistence allows agents to maintain context across interactions, creating smoother, more personalized, and continuous user experiences.*
- **Cross-Session State Management:** Infrastructure to maintain user context and conversation history (Supports `Persistence` attribute from [Key Attributes](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfnPGPErW3FMgQL98sa4J1ABuLLc0us7YOIdgSo2m-_1-w?e=bMO3Dq) and enables affordances like `Memory Externalization`, `Relationship History` from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS))
- **Data Retention Policies:** Clear guidelines on what information is stored and for how long (Impacts user trust and privacy; relates to [Trust and Safety](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfucRQOGB8BIupS9Co4BOVIB5qjm-oHZXqaM8lELci52hg?e=X5IaB6))
- **Memory Prioritization Rules:** Logic for what information should be remembered vs. forgotten (Impacts `Adaptability` attribute from [Key Attributes](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfnPGPErW3FMgQL98sa4J1ABuLLc0us7YOIdgSo2m-_1-w?e=bMO3Dq) and relevance)
- **Synchronization Mechanism:** System to ensure consistent agent state across devices/platforms (Ensures seamless multi-device UX)

### Environmental Operation Requirements
*For agents to perform meaningful work, they need secure and reliable ways to interact with other systems, which must be managed carefully to maintain user trust and system integrity.*
- **API Integration Framework:** Secure connections to internal and external systems (Relates to [Agent-Application Interaction](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/ERZ6v5szfSlPigP_xcehFAUBsHxzefk1bspExPYMH9Wpyw?e=aOTWaz))
- **Credential Management:** Secure storage and handling of access tokens for connected services (Relates to [Trust and Safety](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfucRQOGB8BIupS9Co4BOVIB5qjm-oHZXqaM8lELci52hg?e=X5IaB6))
- **Rate Limiting Controls:** Prevent excessive system usage by the agent (Prevents negative impact on other systems/users)
- **System Health Monitoring:** Track agent interactions with other systems to prevent cascading failures

### Self-Monitoring Requirements
*Agents that can assess their own performance and certainty appear more reliable and trustworthy to users.*
- **Performance Metrics Dashboard:** Track agent effectiveness across key indicators (Relates to [Evaluation Methods](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/Ec1HRUkZGeRNo6GJ8-eosiIBz0HBqE_8GIWY3W9O5LT90A?e=2genRt))
- **Error Detection System:** Identify when agent actions fail or produce unexpected results (Foundation for `Error Handling` UX; relates to [Trust and Safety](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfucRQOGB8BIupS9Co4BOVIB5qjm-oHZXqaM8lELci52hg?e=X5IaB6))
- **Learning Feedback Loop:** Mechanism to incorporate successes/failures into future behavior (Supports `Adaptability` attribute from [Key Attributes](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfnPGPErW3FMgQL98sa4J1ABuLLc0us7YOIdgSo2m-_1-w?e=bMO3Dq) and enables affordances like `Correction Mechanisms`, `Preference Learning` from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS))
- **Confidence Scoring:** System for the agent to assess its certainty about actions/recommendations (Enables `Confidence Indicator` affordance from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS))

### Multi-Step Planning Requirements
*To tackle complex user goals, agents need the ability to plan and execute sequences of actions, which requires infrastructure for decomposition, tracking, and user visibility.*
- **Task Decomposition Engine:** Break complex goals into manageable sub-tasks
- **Dependency Management:** Track relationships between tasks and handle sequencing
- **Goal Alignment & Success Criteria Management:** Mechanisms for establishing, negotiating, and tracking the "definition of done" for user goals (Crucial for user satisfaction and task completion; relates to [Key Attributes](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfnPGPErW3FMgQL98sa4J1ABuLLc0us7YOIdgSo2m-_1-w?e=bMO3Dq))
- **Progress Tracking:** Monitor completion status across multi-step processes (Enables `Progress Tracking` affordance from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS))
- **Plan Visualization:** Make complex plans understandable to users (Enables `Plan Visualization` affordance from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS))

### Delegation Awareness Requirements
*Intelligent delegation requires agents to understand when to act independently and when to consult the user, balancing efficiency with user control.*
- **Escalation Criteria:** Clear thresholds for when to involve humans (Supports `Delegation Awareness` attribute from [Key Attributes](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfnPGPErW3FMgQL98sa4J1ABuLLc0us7YOIdgSo2m-_1-w?e=bMO3Dq))
- **User Availability Detection:** Determine when users are present and can be consulted (Improves timing of interruptions)
- **Interruption Protocols:** Guidelines for when and how to interrupt users for input (Key for non-disruptive UX; relates to [Interaction Styles](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/Efq02z3LGD9MndOXAzt4d4MBlkvBkWJ17RbcFserXoCBuA?e=ALcjk5))
- **Handoff Mechanism:** Smooth transition between agent and human operators (Ensures continuity in `Error Handling` or complex tasks; relates to [Trust and Safety](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfucRQOGB8BIupS9Co4BOVIB5qjm-oHZXqaM8lELci52hg?e=X5IaB6))

### Identity Continuity Requirements
*A consistent identity helps users build a predictable mental model and relationship with the agent.*
- **Personality Definition Framework:** Consistent voice, tone, and behavior parameters (Enables `Personality Calibration` affordance from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS); relates to [Interaction Styles](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/Efq02z3LGD9MndOXAzt4d4MBlkvBkWJ17RbcFserXoCBuA?e=ALcjk5))
- **Brand Alignment Guidelines:** Ensure agent reflects company values and messaging
- **Personalization Boundaries:** Define what aspects of agent behavior can adapt to users (Manages `Adaptability` scope from [Key Attributes](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfnPGPErW3FMgQL98sa4J1ABuLLc0us7YOIdgSo2m-_1-w?e=bMO3Dq))
- **Version Control:** Manage updates to agent behavior without disrupting user expectations (Prevents jarring UX changes)

### Cross-Cutting Business Requirements
*These foundational requirements support the overall quality, safety, usability, and improvement of the agentic experience.*
- **Security & Compliance Framework:** Ensure agent operations meet regulatory requirements (Essential for user trust and safety; relates to [Trust and Safety](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfucRQOGB8BIupS9Co4BOVIB5qjm-oHZXqaM8lELci52hg?e=X5IaB6))
- **User Control Panel:** Central interface for managing agent permissions and behavior (Provides core `Control` and `Transparency` affordances from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS); supports [Trust and Safety](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfucRQOGB8BIupS9Co4BOVIB5qjm-oHZXqaM8lELci52hg?e=X5IaB6))
- **Error Handling & Communication Strategy:** Define how agent errors are detected, communicated to users, and used for improvement, including feedback mechanisms (Crucial for trust and usability; relates to [Trust and Safety](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfucRQOGB8BIupS9Co4BOVIB5qjm-oHZXqaM8lELci52hg?e=X5IaB6), supports `Error Explanation` and `Correction Mechanisms` from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS))
- **Metrics & Analytics System:** Track business impact *and* key UX metrics (e.g., task success, usability, user satisfaction, trust calibration) of agent activities (Relates to [Evaluation Methods](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/Ec1HRUkZGeRNo6GJ8-eosiIBz0HBqE_8GIWY3W9O5LT90A?e=2genRt))
- **Training & Onboarding Process:** Help users understand and effectively use agent capabilities (Essential for adoption and effective use)
- **Feedback & Improvement Cycle:** Continuously enhance agent performance based on outcomes and user feedback (Supports overall UX quality and `Adaptability` from [Key Attributes](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfnPGPErW3FMgQL98sa4J1ABuLLc0us7YOIdgSo2m-_1-w?e=bMO3Dq))
- **Accessibility Standards Compliance:** Ensure agent interactions and interfaces meet relevant accessibility guidelines (Ensures inclusive UX; relates to [Evaluation Methods](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/Ec1HRUkZGeRNo6GJ8-eosiIBz0HBqE_8GIWY3W9O5LT90A?e=2genRt))


## 2. Implementation Prioritization Framework

When planning the development roadmap for agentic features, teams should prioritize requirements based on their criticality to delivering core agent functionality and a baseline trustworthy user experience. This framework categorizes the business requirements into three implementation tiers:

### Critical Path Requirements (Must-Have for MVP)
These requirements form the foundation of any agentic experience and must be implemented first to deliver even a minimal viable product that users can begin to trust and control:

| Requirement | Rationale |
|-------------|-----------|
| **Delegated Authority Framework** | Defines basic agent boundaries, essential for user safety and predictable behavior |
| **Fallback Protocols** | Ensures safety and prevents agent failures blocking workflows, critical for user trust |
| **Cross-Session State Management** | Enables fundamental persistence for a coherent, non-stateless user experience |
| **API Integration Framework** | Provides the agent's core ability to take meaningful action, delivering user value |
| **Escalation Criteria** | Establishes when to involve humans, crucial for maintaining user agency and trust |
| **Security & Compliance Framework** | Protects users and organization, foundational for user trust |
| **User Control Panel** | Gives users essential control and transparency, supporting user agency |
| **Audit Trail System** | Creates accountability and aids debugging, contributing to transparency and trust |
| **Error Handling & Communication Strategy** | Defines baseline response to failures, essential for managing user frustration and trust |


### Core Requirements (Required for Full Implementation)
These requirements should be implemented after the critical path to deliver a complete, robust, and more effective agentic experience:

| Requirement | Rationale |
|-------------|-----------|
| **Permission Hierarchy** | Enables nuanced control based on risk, enhancing user safety and flexibility |
| **Data Retention Policies** | Ensures appropriate data handling, important for user privacy and trust |
| **Credential Management** | Secures connections, maintaining system integrity and user trust |
| **Error Detection System** | Improves identification of failures, enabling better recovery and learning for a smoother UX |
| **Task Decomposition Engine** | Allows agent to handle more complex goals, increasing user value |
| **Goal Alignment & Success Criteria Management** | Ensures agent works towards the user's actual goal, key for user satisfaction |
| **Progress Tracking** | Monitors multi-step progress, providing transparency and managing user expectations |
| **Handoff Mechanism** | Enables smoother agent-human collaboration, improving UX in complex cases |
| **Brand Alignment Guidelines** | Ensures agent reflects brand values, impacting user perception |
| **Training & Onboarding Process** | Helps users learn effectively, crucial for successful adoption and UX |
| **Accessibility Standards Compliance** | Ensures the experience is usable by everyone, a core aspect of good UX |


### Enhancement Requirements (Nice-to-Have Post-MVP)
These requirements enhance the agent experience, making it more refined, intelligent, and personalized, but can be implemented after core functionality is established:

| Requirement | Rationale |
|-------------|-----------|
| **Memory Prioritization Rules** | Refines agent memory for better relevance and personalization in the UX (Relates to [Key Attributes](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfnPGPErW3FMgQL98sa4J1ABuLLc0us7YOIdgSo2m-_1-w?e=bMO3Dq)) |
| **Synchronization Mechanism** | Ensures consistent state across devices, providing a seamless multi-device UX |
| **Rate Limiting Controls** | Prevents system abuse, indirectly protecting overall user experience |
| **System Health Monitoring** | Tracks system interactions, helping maintain reliability and a stable UX |
| **Performance Metrics Dashboard** | Provides detailed effectiveness data for iterative UX improvements (Relates to [Evaluation Methods](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/Ec1HRUkZGeRNo6GJ8-eosiIBz0HBqE_8GIWY3W9O5LT90A?e=2genRt)) |
| **Learning Feedback Loop** | Enables agent adaptation based on feedback, improving personalization and UX over time (Supports [Key Attributes](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfnPGPErW3FMgQL98sa4J1ABuLLc0us7YOIdgSo2m-_1-w?e=bMO3Dq), [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS)) |
| **Confidence Scoring** | Allows agent to express certainty, enabling better user trust calibration via `Confidence Indicators` (from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS)) |
| **Dependency Management** | Handles task relationships for more complex planning, supporting more advanced user goals |
| **Plan Visualization** | Makes complex plans understandable via `Plan Visualization` affordance (from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS)), enhancing transparency |
| **User Availability Detection** | Improves timing of interruptions, creating a less disruptive UX |
| **Interruption Protocols** | Refines interruption handling for a smoother, more polite UX (Relates to [Interaction Styles](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/Efq02z3LGD9MndOXAzt4d4MBlkvBkWJ17RbcFserXoCBuA?e=ALcjk5)) |
| **Personality Definition Framework** | Creates consistent voice/tone via `Personality Calibration` (from [UI Affordances and Patterns](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EaP2bgTo63dEvy_aMMBfKhcBp9Z7jc_YumEWYQq_8Nm1aA?e=US0IhS)), enhancing relationship building (Relates to [Interaction Styles](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/Efq02z3LGD9MndOXAzt4d4MBlkvBkWJ17RbcFserXoCBuA?e=ALcjk5)) |
| **Personalization Boundaries** | Defines adaptation scope (from [Key Attributes](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfnPGPErW3FMgQL98sa4J1ABuLLc0us7YOIdgSo2m-_1-w?e=bMO3Dq)), managing user expectations about personalization |
| **Version Control** | Manages behavior updates smoothly, preventing jarring UX changes |
| **Metrics & Analytics System** | Tracks detailed business *and UX* impact for informed product decisions (Relates to [Evaluation Methods](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/Ec1HRUkZGeRNo6GJ8-eosiIBz0HBqE_8GIWY3W9O5LT90A?e=2genRt)) |
| **Feedback & Improvement Cycle** | Continuously enhances agent performance and UX based on outcomes (Supports [Key Attributes](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EfnPGPErW3FMgQL98sa4J1ABuLLc0us7YOIdgSo2m-_1-w?e=bMO3Dq)) |


## 3. Further Considerations

*The field of Agentic AI UX is rapidly evolving, and successful implementation extends beyond technical requirements into fundamental organizational strategy. The following points represent complex, ongoing areas that merit deep thought, research, and discussion among business leaders, product teams, and legal/compliance departments. These are not questions with simple right or wrong answers; rather, they highlight strategic challenges inherent in integrating autonomous systems responsibly and effectively into business operations. Exploring these considerations is key to aligning agentic capabilities with sustainable business value.*

### Balancing Innovation and Compliance
Agentic systems introduce powerful new capabilities but also operate within existing (and sometimes evolving) regulatory landscapes. How can organizations foster rapid innovation in AI while ensuring robust compliance and managing associated risks? Striking this balance is crucial for long-term viability and societal trust.

### Organizational Adaptation for Agentic AI
Developing, deploying, and maintaining agentic features often requires shifts in team structures, skill sets, and operational processes. What organizational changes—from engineering practices to product management and support models—are necessary to effectively manage the lifecycle of these complex systems?

### Measuring the Return on Agentic Investments
Quantifying the value derived from agentic AI capabilities can be challenging, as benefits might include indirect effects like improved decision quality or employee focus, not just direct efficiency gains. How should product teams approach measuring the Return on Investment (ROI) for agentic features in a way that captures their full impact?

### Establishing Responsible Governance
Autonomous agents operating with delegated authority necessitate strong governance frameworks. What structures, policies, and oversight mechanisms are most effective in ensuring responsible development, deployment, and ongoing operation of agentic systems, particularly concerning ethics, accountability, and unintended consequences?

## 4. Related Sections

- For a complete overview of all sections, see the [Overview](https://microsoft.sharepoint.com/:w:/t/HorizonFramework/EdCm_1Tnl8pBn5jf3wGTVD8BF0_PGmNaC5EJGySYrE3nIw?e=Qxg1bw)