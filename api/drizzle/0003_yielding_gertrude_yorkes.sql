CREATE TABLE "language_course_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid,
	"target_language_code" varchar(20) NOT NULL,
	"level" varchar(20) DEFAULT 'A1' NOT NULL,
	"title" varchar(255) NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "language_lesson_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_template_id" uuid NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"title" varchar(255) NOT NULL,
	"objective" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "language_vocab_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_template_id" uuid NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"term" varchar(255) NOT NULL,
	"translation" varchar(255) NOT NULL,
	"part_of_speech" varchar(60),
	"target_example" text,
	"native_example" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "language_courses" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "language_course_templates" ADD CONSTRAINT "language_course_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_lesson_templates" ADD CONSTRAINT "language_lesson_templates_course_template_id_language_course_templates_id_fk" FOREIGN KEY ("course_template_id") REFERENCES "public"."language_course_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_vocab_template_items" ADD CONSTRAINT "language_vocab_template_items_lesson_template_id_language_lesson_templates_id_fk" FOREIGN KEY ("lesson_template_id") REFERENCES "public"."language_lesson_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "language_courses" ADD CONSTRAINT "language_courses_template_id_language_course_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."language_course_templates"("id") ON DELETE set null ON UPDATE no action;