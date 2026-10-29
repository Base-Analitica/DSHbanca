import {
    validateSkill,
    validateAllSkills,
    validateSkillContent,
    parseSkillFrontmatter,
    type ValidationError,
} from "../src/lib/skill_validator";

export {
    validateSkill,
    validateAllSkills,
    validateSkillContent,
    parseSkillFrontmatter,
    type ValidationError,
};

if (import.meta.main) {
    const skillsDir = process.env.SKILLS_DIR || "skills";
    const errors = validateAllSkills(skillsDir);
    if (errors.length > 0) {
        console.error("Skill validation failed:");
        for (const err of errors) {
            console.error(`- ${err.file}: ${err.message}`);
        }
        process.exit(1);
    } else {
        console.log("All skills are valid.");
        process.exit(0);
    }
}
