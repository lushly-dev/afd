In this video, I'm going to be going
0:01
over progressive disclosure within Cloud
0:03
Code. Now, one of the interesting trends
0:05
that I've noticed over the past several
0:07
months is a lot of AI infrastructure
0:09
companies from Cloudflare, Anthropic,
0:11
Verscell, Cursor, from products to model
0:14
companies across the board are all
0:16
arriving at the same conclusion
0:18
independently, and that's in and around
0:20
how to build AI agents. And honestly,
0:22
it's not probably what we would have
0:23
expected 6 months ago. In this video,
0:26
I'm going to be touching on progressive
0:27
disclosure, but I'm also going to be
0:29
touching on bash and file systems
0:30
generally. Now, this is going to be
0:32
applicable to how you can use cloud
0:34
code, but you can also use this within
0:35
other systems as well as how you can
0:37
develop agents. Right off the bat, I
0:39
want to touch on this blog post that
0:40
came out in September from Cloudflare
0:43
code mode, the better way to use MCP. In
0:45
this article, they basically describe
0:46
that the way that we've been using MCP
0:48
is completely wrong. And one of the
0:50
ideas with this is when we load up the
0:52
MCP directly as tools to the LLM, there
0:55
are a number of different issues with
0:57
that that actually come up. You might
0:59
have those MCPS within context and then
1:01
never actually use them. And one of the
1:03
interesting things with this approach
1:04
was actually converting MCPS to
1:06
TypeScript. And the realization was
1:07
effectively models are really good at
1:09
writing code. They're not necessarily
1:11
great at leveraging MCP. And essentially
1:13
what this boils down to is what if we
1:15
just had the model write the code, find
1:16
the MCPS that it needs rather than
1:18
having that all within the context. And
1:20
just a couple months later, Anthropic
1:22
basically confirmed the same conclusion.
1:24
They released some product features.
1:26
This was something that really didn't
1:27
get a lot of attention when it
1:29
originally came out. Basically, the idea
1:31
is instead of loading all of the tool
1:33
definitions up front, the tool search
1:35
tool discovers tools on demand. Claude
1:37
only sees the tools that it actually
1:39
needs for the current task. You can see
1:41
the context window at the top here of
1:43
the previous way using 77,000 tokens of
1:46
context. And then below with the tool
1:48
search tool, it only has 8,700 tokens.
1:51
This represented an 85% reduction in
1:54
token usage while maintaining access to
1:56
your full tool library. And internal
1:58
testing showed significant accuracy
2:00
improvements on MCP evaluations when
2:03
working with large tool libraries. Opus
2:05
4 improved from 49% to 74% and Opus 4.5
2:10
improved from 79.5% to 88.1%. The idea
2:14
with this is if you only have the tools
2:16
that you actually need or are using at
2:18
the current time, that context window is
2:21
going to work much more effectively. And
2:22
what was interesting with this is just
2:24
last week cursor also confirmed the same
2:26
thing. Effectively, here's the exact
2:28
same chart that I just showed you and
2:30
they explain the efficiency gains that
2:32
they do by doing this. but has reduced
2:34
the total agent tokens by 46.9%. And the
2:37
other thing that's really great with
2:38
this is when you're putting those MCP
2:40
tools within the context and you're not
2:41
necessarily using them all the time,
2:43
you're going to be spending an awful lot
2:45
of money just sending in those requests
2:47
for just if they happen to need them. I
2:50
think this paradigm basically been
2:51
confirmed by enough heavy hitters within
2:54
the industry that this is a good pattern
2:56
to follow. And the interesting things
2:58
with this is we went from the focus
2:59
being in and around GPUs and now we're
3:02
moving to an interesting area where I
3:04
think sandboxes and file systems at
3:06
least the time of inference and when
3:08
we're using these AI applications is
3:10
going to become increasingly the focus
3:12
and effectively they all arrived at the
3:14
same conclusion. Progressively disclose
3:16
only what you need to the model when you
3:17
need it. The industry trend in terms of
3:19
how this is done is give agents a file
3:22
system as well as bash and let them
3:24
leverage those methods like being able
3:26
to GP and glob and find all the
3:29
different files that it needs and load
3:31
them up only when it needs that. Now in
3:33
terms of MCP now a lot of people have
3:35
given it flak over time. I don't think
3:37
it's going anywhere but in terms of the
3:38
way that we're actually leveraging it
3:40
just like Cloudflare mentioned that's
3:41
going to be the biggest change. Instead
3:43
of burning tokens and having all of
3:44
these different servers within the agent
3:46
context, whether it's within cloud code,
3:48
cursor, or the agentic products that
3:50
we're building, we're going to have a
3:52
more effective way of how we're going to
3:54
be managing MCPS. And honestly, in my
3:56
opinion, it's a great protocol. A lot of
3:58
people have adopted it. There's easy
4:00
ways to deal with authentication and
4:02
things like that depending on the
4:03
services. There's a lot that's been
4:05
ironed out. I don't think that's going
4:06
away anytime soon. But I think the big
4:08
trend that we're going to see is instead
4:09
of having that tool schema sit within
4:11
context, we're going to have a lot of
4:13
those tools that would have otherwise
4:14
live within context progressively
4:16
disclose because there's going to be a
4:17
lot of tools that you might only use one
4:19
in 10 times for each turn of the
4:22
conversation. For instance, maybe even
4:23
less than that. Now, in terms of the
4:25
approaches for this, what's great with
4:26
this is it's actually really easy to set
4:28
up. Skills are the most obvious way to
4:30
use this within cloud code. You can set
4:32
up a skill file. The front matter is
4:34
going to be disclosed to the model.
4:35
You're going to be able to have the
4:36
description when the model actually
4:38
invokes different things and you can
4:40
move from really just 10 20 30 100
4:42
tokens within the front matter and then
4:44
have these skills where it will load the
4:46
first file and then it can have
4:47
references within that skill and
4:49
progressively disclose within each skill
4:51
and then also it can go and look through
4:53
all of the different other skills that
4:55
it has and similar thing progressively
4:57
disclose and only read those and load
4:59
them up as prompts within context when
5:01
needed. The insight and the shift is
5:03
really instead of just loading
5:04
everything, burning all the tokens,
5:06
having less room for actual work and
5:08
degrading results of what the model is
5:09
actually capable of doing because say if
5:11
the context is at 100,000 tokens of
5:14
context, the results that you'll get
5:16
where if it had maybe just 10,000, it's
5:19
going to be much less. And we're moving
5:20
to a way where we're going to be
5:22
discovering things on demand, loading
5:23
only what's needed. And the other great
5:25
thing with this is we're going to have
5:26
massive token savings, which means
5:28
faster applications, cheaper
5:30
applications, and overall better
5:32
results. Agents, they need file systems
5:34
and bash, and you can effectively get
5:36
out of the way. Now, the thing with this
5:37
is it's really a different new
5:39
architecture. I was actually uneasy with
5:41
this type of idea initially, but the
5:44
thing with it, I think that's really at
5:46
the essence that makes this really nice
5:47
is it's actually really intuitive,
5:49
right? You can have these different
5:50
files. They can progressively disclose.
5:52
They can be within directories. they can
5:54
encode this knowledge and that's the
5:56
interesting thing with this pattern is
5:58
you don't need to equip an agent with
5:59
the knowledge of how to use a Postgress
6:02
database or how to use this or that
6:04
every single agent out there knows how
6:06
to use bash and once you know how to use
6:07
bash you can update files you can read
6:09
files you can use all of these different
6:11
methods like skills which is effectively
6:13
progressive disclosure which is the same
6:15
type of idea with all of this the
6:16
insight that Cloudflare had was instead
6:18
of generating JSON tool calls generate
6:20
TypeScript code that runs in a sandbox
6:22
the MCP P server becomes a TypeScript
6:25
API in isolated sandboxes. And the
6:27
result that they found with this is a
6:29
98.7%
6:31
reduction in token usage. Back to the
6:33
blog post with Anthropic. Now within
6:35
advanced tool use, there were a few
6:36
different things that they put out and
6:38
they all sort of correlate to one
6:39
another. They had the tool search tool,
6:41
the programmatic tool calling as well as
6:43
the memory tool. With programmatic tool
6:44
calling, for instance, the way that this
6:46
works similar to what Cloudflare
6:48
discovered, it will invoke the tools in
6:50
a code execution environment. Then in
6:52
terms of memory, these are file-based
6:54
simple markdown files. It was a similar
6:56
idea within cloud code. Something that
6:57
Boris Churnney I've heard him mention
6:59
where instead of having all of the
7:01
embeddings and vector, just have that
7:03
gentic search. It just felt better. It
7:05
just works well. And I think if you've
7:07
leveraged cloud code, seeing how it
7:08
reads different files, reads sections of
7:11
files at times, that feels like a much
7:13
better approach than all of the
7:15
mechanics that go into a lot of these
7:18
embeddings type of systems. Next up,
7:19
this is a little piece of alpha. Right
7:21
now, there's an experimental MCP CLI.
7:24
There are a couple ways this is changing
7:26
at time of recording when I put this
7:27
out. This might have actually changed to
7:29
another flag. It could potentially be
7:31
removed as they're working on it. This
7:33
is something that they're actively
7:34
trying out is how to get that tool
7:36
search capability directly within Cloud
7:38
Code. Now, what you can do with this is
7:40
instead of having all of that MCP within
7:42
the context window of cloud code, if you
7:44
set this flag, you're going to be able
7:46
to have the same tool search capability
7:48
and instead of loading all of those
7:50
tokens within context, you'll be able to
7:52
have that same capability. Now, is it
7:54
perfect? Is it right? I found it work
7:56
quite well, but does it work quite as
7:58
well as having the MCPS directly within
8:00
context? I'm not entirely sure. So, this
8:03
is still actively a work in progress,
8:05
but if you want to try it out, it's a
8:06
really simple flag within Cloud Code
8:08
that you can use if you want to try this
8:09
out. And the really wild thing with this
8:11
direction is if you had a number of
8:12
different MCP servers, that could easily
8:14
add up into tens of thousands of tokens
8:16
of context that was being directly
8:18
passed to the model every single time.
8:21
And this effectively brings it down to
8:23
almost zero. Now, there will be a little
8:25
bit within the system prompt in terms of
8:26
how they actually make this work and
8:28
those mechanics, but it really is orders
8:30
of magnitude less context that you're
8:33
going to be using from something like
8:34
that. And I think the big and exciting
8:35
thing with this is all of a sudden we
8:37
can be a lot more ambitious. We don't
8:39
need to be bound by only being able to
8:41
have 5, 10, 20 MCP servers and then all
8:44
of a sudden the performance degrades
8:46
within our application or within cloud
8:47
code. Now we can have thousands, tens of
8:50
thousands, maybe even hundreds of
8:52
thousands of skills or MCPS or whatever
8:55
that is within a directory or within a
8:58
system that's easily able to look up and
9:00
find what it needs at time of when it
9:02
needs it. And additionally, we can have
9:04
hierarchical structures similar to
9:06
skills is you can have a flat directory
9:08
of all of the different skills, but you
9:10
can also break it up into subsklls. it
9:13
can read different pieces and discover,
9:14
okay, I need this reference that's
9:16
within this skill file and go down the
9:18
lineage and find what it needs. There's
9:20
a few different ways in terms of the
9:21
architecture of this, but all in all, I
9:23
think this is the paradigm shift that
9:25
we're going through right now, like
9:26
literally over the coming weeks and
9:28
months where all of a sudden we're going
9:30
to have applications that are going to
9:31
have access to a ton more capabilities
9:34
and work quite effectively through some
9:36
of these strategies. And I think what's
9:38
interesting with this whether it's
9:39
Anthropic within their web app they use
9:41
sandboxes now their sandbox products
9:43
from Verscell Cloudflare Daytona Lovable
9:46
uses a form of sandboxes all of these
9:49
different sandboxes. What it allows us
9:51
to do is to have these sort of ephemeral
9:53
file systems where we can read and write
9:54
to spin up little applications and then
9:56
shut them down as needed. I think this
9:58
is going to be much more of the paradigm
10:00
in 2026 for agentic development and how
10:04
you can also leverage cloud code. If
10:05
you're leveraging cloud code within the
10:07
cloud, similar idea here, they're
10:08
spinning up a sandbox. But what's
10:10
interesting with Anthropic is within
10:12
even cloud, the consumerf facing web
10:14
app, you'll notice that it will also
10:16
write to a file system for a lot of
10:18
different operations. It will also write
10:20
scripts as well for a lot of different
10:21
features like if you're working with a
10:23
spreadsheet or whatever it might be. All
10:25
in all, if we boil it down, MCP's file
10:27
system and code execution, that might be
10:29
the answer, at least as it stands right
10:31
now. Just to run through the pattern
10:32
quickly on how you could use this within
10:34
cloud code. You have access to the file
10:36
systems. It can read, write, search
10:37
files. We've all seen it leverage that
10:39
within the core methods. It has bash as
10:41
well. Execute commands, run scripts,
10:43
push things to git, whatever it might
10:45
be. And then now what we can do is we
10:47
can have code execution to call the MCP
10:50
servers. The idea and the mindset to
10:51
think about is give the agent a file
10:53
system and get out of the way. Tools
10:55
become files, discovery becomes search,
10:57
execution becomes code, and context
10:59
remain small. Next up, another
11:01
interesting insight that Anthropic had
11:03
was that Claude can automatically clear
11:05
old tool results as you approach your
11:07
limits. So, this is another interesting
11:09
idea that instead of having and adding
11:11
those all to context is you can
11:13
progressively remove those from context
11:15
as they might become less and less
11:17
relevant. Now, in terms of memory, I
11:19
think the way to think about this is
11:20
it's just files. This can be your
11:21
claw.md. This can be different MD files.
11:24
This can be different scripts. This can
11:25
be skills. It's nothing too complicated.
11:27
There's no embeddings. There's no
11:28
complex retrieval. Just keep it simple.
11:31
We can read it. We can edit it. We can
11:33
search it. Keep it simple. If it's
11:34
simple for us, it's going to be simple
11:36
for agents. Now, how do we actually
11:37
leverage this? So, I think it's with
11:39
skills and progressive disclosure. So,
11:40
within cloud code, you can create a
11:42
skills directory and you can put
11:44
different skills that you have. It might
11:46
be a web research skill. It could be a
11:48
code review skill. Within that skill
11:50
file, you can chain different references
11:51
to different scripts, different markdown
11:53
files. And that's going to be how you
11:55
can have these different files where it
11:57
will read and load up only at time of
12:00
when it needs it. Effectively how it
12:01
works, the agent will see the front
12:02
matter of the skill and that's going to
12:04
be what gets loaded within the static
12:06
context. Say it's a web research skill.
12:08
You could say okay within this skill I
12:10
have firecrawl or what have you within
12:11
that skill and then the agent will only
12:13
search and read that skill folder and
12:15
load up all of the context that it needs
12:18
when it actually needs it. So the idea
12:20
with this is you're going to be able to
12:21
scale to many more skills without that
12:24
additional context bloat. Okay. So all
12:25
in all, I think you can now be more
12:27
ambitious without context burn worries.
12:29
Agents can tackle bigger tasks. Before
12:31
we had to keep tasks a little bit small.
12:33
We had to minimize tool use, watch for
12:35
context limits, worry about it
12:37
resetting, and now we can have things
12:39
that can run for multiple hours, use
12:41
potentially dozens or hundreds or maybe
12:43
even thousands of different tool
12:44
integrations. We can have these complex
12:46
workflows without complex orchestration.
12:48
If the system knows how to effectively
12:50
look up for tools as well as skills, all
12:52
of a sudden these systems become much
12:55
more powerful and much more ambitious in
12:57
terms of what we can build. We can build
12:58
systems that potentially run for hours,
13:00
run autonomously all of a sudden as a
13:02
result of some of these new patterns.
13:04
Context potentially is no longer the
13:05
bottleneck. If we can just offload
13:07
context to memory to these different
13:09
files, we can leverage the tool search
13:12
capabilities. We can leverage the skill
13:14
and progressive lookup capabilities. All
13:16
of this combined is a really effective
13:19
way to manage context. We can have a
13:21
system that sort of has memory and
13:23
working memory, can write helper
13:25
scripts, can update skills. There's a
13:27
ton that we can do by leveraging the
13:29
file system and bash that I think is
13:30
pretty exciting. All in all, I think the
13:32
trend is pretty clear. I think
13:33
Cloudflare had a lot of really
13:35
interesting ideas. Then anthropic came
13:36
out, cursor, and now I think everyone is
13:39
converging on, hey, this is actually a
13:41
pretty good idea and pattern. It's a
13:43
little counterintuitive, but it does
13:45
work. and the industry is really
13:46
converging in and around the same answer
13:48
right now. Tools as files, loaded on
13:50
demand, bills, progressive disclosure,
13:53
bash is all you need. That's pretty much
13:54
it for this video. If you found this
13:56
video useful, please comment, share, and
13:57
subscribe. Otherwise, until next one.