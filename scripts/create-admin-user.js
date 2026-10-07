const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL || "https://nnqlnbgfbixckrxmxdzt.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ucWxuYmdmYml4Y2tyeG14ZHp0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM2ODQ2NSwiZXhwIjoyMTA1OTQ0NDY1fQ.XgmhHnpYSnnVZ_o9O3wkUZru8Iu6WKxf4MCPne8UdZE";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const email = process.argv[2] || "admin@cantame.com";
  const password = process.argv[3] || "Cantame#Admin2026!";

  console.log(`Criando usuário admin: ${email}...`);

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    console.error("Erro ao criar usuário:", error.message);
    process.exit(1);
  }

  console.log("Usuário criado com sucesso!");
  console.log("ID:", data.user.id);
  console.log("Email:", data.user.email);
}

main();
