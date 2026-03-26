-- ============================================================
-- ASKI Flow  --  Auth Tables for SQL Server
-- Jalankan script ini pada SQL Server database Anda
-- ============================================================

-- GANTI nama database sesuai kebutuhan
USE [askiflow_db];
GO

-- ============================================================
-- TABLE: aski_users
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_users')
BEGIN
    CREATE TABLE aski_users (
        id            INT IDENTITY(1,1)  PRIMARY KEY,
        username      NVARCHAR(100)      NOT NULL  UNIQUE,
        password_hash NVARCHAR(255)      NOT NULL,
        role          NVARCHAR(20)       NOT NULL  CHECK (role IN ('admin', 'operator')),
        is_active     BIT                NOT NULL  DEFAULT 1,
        created_at    DATETIME2          NOT NULL  DEFAULT GETDATE(),
        last_login    DATETIME2          NULL
    );
    PRINT 'Table aski_users created.';
END
ELSE
    PRINT 'Table aski_users already exists (skipped).';
GO

-- ============================================================
-- Seed: Default admin user
--
-- PENTING: Ganti password sebelum deploy ke production!
-- Untuk generate bcrypt hash, jalankan perintah Python ini:
--
--   python -c "import bcrypt; h = bcrypt.hashpw(b'admin123', bcrypt.gensalt(12)); print(h.decode())"
--
-- Salin output-nya dan tempel di kolom password_hash di bawah.
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM aski_users WHERE username = 'admin')
BEGIN
    -- Hash di bawah = bcrypt('admin123', rounds=12)
    -- GANTI dengan hash baru yang Anda generate sendiri!
    INSERT INTO aski_users (username, password_hash, role)
    VALUES ('admin', '$2b$12$VO4.gbkPTVsqaLOCPEkG1OQCZaKXZlF.jNd0nB.yQcEPJhR/kZC3q', 'admin');
    PRINT 'Default admin user inserted. SEGERA ganti password!';
END
ELSE
    PRINT 'Admin user already exists (skipped).';
GO

-- ============================================================
-- TABLE: aski_flow_templates
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_flow_templates')
BEGIN
    CREATE TABLE aski_flow_templates (
        id                 INT IDENTITY(1,1) PRIMARY KEY,
        name               NVARCHAR(200)     NOT NULL,
        description        NVARCHAR(1000)    NULL,
        is_active          BIT               NOT NULL DEFAULT 1,
        current_version_id INT               NULL,
        created_by         INT               NULL,
        updated_by         INT               NULL,
        created_at         DATETIME2         NOT NULL DEFAULT GETDATE(),
        updated_at         DATETIME2         NOT NULL DEFAULT GETDATE()
    );
    PRINT 'Table aski_flow_templates created.';
END
ELSE
    PRINT 'Table aski_flow_templates already exists (skipped).';
GO

-- ============================================================
-- TABLE: aski_flow_template_versions
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'aski_flow_template_versions')
BEGIN
    CREATE TABLE aski_flow_template_versions (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        template_id    INT               NOT NULL,
        version_number INT               NOT NULL,
        flow_json      NVARCHAR(MAX)     NOT NULL,
        policy_json    NVARCHAR(MAX)     NOT NULL,
        flow_hash      NVARCHAR(64)      NOT NULL,
        created_by     INT               NULL,
        created_at     DATETIME2         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_aski_flow_template_versions_template
            FOREIGN KEY (template_id) REFERENCES aski_flow_templates(id),
        CONSTRAINT UQ_aski_flow_template_versions_template_version
            UNIQUE (template_id, version_number)
    );
    PRINT 'Table aski_flow_template_versions created.';
END
ELSE
    PRINT 'Table aski_flow_template_versions already exists (skipped).';
GO

PRINT '=== ASKI Auth setup complete! ===';
GO
