# Bitburner Scripts

This is basically an experiment.

I have around 25+ years of software development experience, and with the ever closer AI revolution coming, I decided to use Bitburner as a vehicle to experiment with AI prompting for code generation.

## Why Bitburner?

Bitburner makes a useful sandbox for this because it uses vanilla JavaScript alongside a well-defined API. That gives AI-generated code a relatively constrained environment in which it can be designed, tested, diagnosed, and iterated.

## Did I write any of the code?

Yes.

I wrote the original bare-bones versions of what I considered the core subset of scripts, then passed them into GPT and let her rip.

Over time, the scripts have been refined, split into more focused components, and extended with diagnostic tooling intended to provide actionable feedback both to the player and back to the AI.

The current suite is **Version 2.4**.

It includes:

- automated startup and recovery;
- network deployment and rooting;
- remote target assignment;
- persistent weaken/grow/hack management;
- purchased-server management;
- controlled spare-RAM `share()` use;
- operational dashboards and diagnostics;
- coding-contract discovery, triage and solving;
- critical backdoor/progression tracking.

## Documentation

Quick start:

```text
STARTUP_v2_4.md
```

Full architecture and operating manual:

```text
Bitburner_Script_Suite_v2_4_Manual.txt
```

## Development approach

The live Bitburner environment is used as the test environment.

The normal workflow is:

```text
design/change
    -> produce complete drop-in script
    -> test in Bitburner
    -> sync tested source to repository
    -> commit
```

Git is therefore intended to represent tested working source rather than generated runtime state.

Generated Bitburner data such as catalogues, diagnostics, copied remote scripts, and other runtime artefacts are excluded through `.gitignore`.

## What this repository is

This is not intended as an example of perfect code, nor as a demonstration of my coding skill.

It is an experiment in using an AI as a development collaborator inside a bounded software system.

I invite people to read the code, critique it, experiment with it, and improve the script library.

+MooMF
